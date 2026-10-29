"""Run the exact same local cases through isolated CPU engine workers."""
import argparse
import base64
import csv
import hashlib
import html
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from metrics import evaluate

ROOT = Path(__file__).resolve().parent
ENGINES = ["tesseract", "paddle", "handwriting-line"]


def load_cases(manifest):
    document = json.loads(manifest.read_text(encoding="utf-8"))
    cases = document["cases"]
    if not cases or len(cases) > 100:
        raise ValueError("Use 1..100 synthetic test cases")
    ids = set()
    total_bytes = 0
    for case in cases:
        image = (manifest.parent / case["image"]).resolve()
        if not image.is_relative_to(manifest.parent.resolve()) or image.suffix.lower() not in (".png", ".jpg", ".jpeg"):
            raise ValueError("Image must be inside the manifest directory")
        if case["kind"] not in ("font_print", "human_handwriting") or case["id"] in ids:
            raise ValueError("Invalid provenance or duplicate case ID")
        if case["kind"] == "human_handwriting" and case.get("ground_truth_verified") is not True:
            raise ValueError("Human handwriting requires explicitly verified ground truth before scoring")
        if not isinstance(case["text"], str) or not 1 <= len(case["text"]) <= 10_000:
            raise ValueError("Ground truth must be 1..10000 codepoints")
        size = image.stat().st_size
        if not 0 < size <= 5 * 1024 * 1024:
            raise ValueError("Image size limit exceeded")
        total_bytes += size
        if total_bytes > 32 * 1024 * 1024:
            raise ValueError("Use batches below 32 MiB to bound base64 memory overhead")
        if hashlib.sha256(image.read_bytes()).hexdigest() != case["sha256"]:
            raise ValueError("Image hash mismatch")
        ids.add(case["id"])
    return cases


def run_worker(engine, payloads, timeout):
    try:
        response = subprocess.run([sys.executable, "-X", "utf8", "-u", str(ROOT / "worker.py"), "--engine", engine],
                                  input="".join(json.dumps(item) + "\n" for item in payloads).encode("utf-8"),
                                  capture_output=True, timeout=timeout,
                                  cwd=ROOT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        # Native Windows diagnostics on stderr can be CP949; protocol stdout is UTF-8.
        lines = response.stdout.decode("utf-8").splitlines()
        if response.returncode or len(lines) != len(payloads):
            raise ValueError("WORKER_PROTOCOL_FAILED")
        return [json.loads(line) for line in lines]
    except subprocess.TimeoutExpired:
        return [{"ok": False, "engine": engine, "error": "WORKER_TIMEOUT"} for _ in payloads]
    except (OSError, ValueError, UnicodeError):
        return [{"ok": False, "engine": engine, "error": "WORKER_FAILED"} for _ in payloads]


def summarize(rows):
    summaries = []
    for engine in sorted({row["engine"] for row in rows}):
        for kind in sorted({row["kind"] for row in rows}):
            group = [r for r in rows if r["engine"] == engine and r["kind"] == kind]
            successes = [r for r in group if r["ok"]]
            record = {"engine": engine, "kind": kind, "attempts": len(group), "succeeded": len(successes), "failed": len(group) - len(successes)}
            for mode in ("raw", "nfc"):
                record[mode] = ({"cer": sum(r["metrics"][mode]["char_errors"] for r in successes) / max(1, sum(r["metrics"][mode]["reference_chars"] for r in successes)),
                                 "wer": sum(r["metrics"][mode]["word_errors"] for r in successes) / max(1, sum(r["metrics"][mode]["reference_words"] for r in successes))} if successes else None)
            record["mean_inference_ms"] = sum(r["elapsed_ms"] for r in successes) / len(successes) if successes else None
            record["numeric_mismatches"] = sum(r["metrics"]["numbers"]["mismatch"] for r in successes)
            record["keyword_flagged"] = sum(bool(r["metrics"]["keyword_changes"]) for r in successes)
            summaries.append(record)
    return summaries


def report(rows, summaries, output):
    output.mkdir(parents=True, exist_ok=True)
    document = {"python": platform.python_version(), "platform": platform.platform(),
                "normalization": "raw and NFC only; CER includes whitespace/punctuation; WER uses split(); empty-reference denominator=1",
                "handwriting_measured": any(r["kind"] == "human_handwriting" and r["ok"] for r in rows),
                "summary": summaries, "rows": rows}
    (output / "benchmark.json").write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output / "benchmark.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        fields = ["engine", "model", "case_id", "kind", "image", "reference", "text", "ok", "elapsed_ms", "load_ms", "rss_bytes_after", "raw_cer", "raw_wer", "nfc_cer", "nfc_wer", "numeric_mismatch", "keyword_changes", "error"]
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            flat = {key: row.get(key, "") for key in fields}
            if row["ok"]:
                for mode in ("raw", "nfc"):
                    for metric in ("cer", "wer"):
                        flat[f"{mode}_{metric}"] = row["metrics"][mode][metric]
                flat["numeric_mismatch"] = row["metrics"]["numbers"]["mismatch"]
                flat["keyword_changes"] = json.dumps(row["metrics"]["keyword_changes"], ensure_ascii=False)
            # Avoid CSV formula execution if later opened in spreadsheet software.
            writer.writerow({key: ("'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value) for key, value in flat.items()})
    cards = []
    for row in rows:
        picture = html.escape(row["image_data_url"], quote=True)
        label = "실제 손글씨 시험 이미지" if row["kind"] == "human_handwriting" else "합성 인쇄체 시험 이미지"
        cards.append(f'<article><h2>{html.escape(row["engine"])} / {html.escape(row["case_id"])}</h2><img src="{picture}" alt="{label}"><pre>정답: {html.escape(row["reference"])}\n결과: {html.escape(row.get("text", ""))}</pre><pre>{html.escape(json.dumps(row.get("metrics", {"error": row.get("error")}), ensure_ascii=False, indent=2))}</pre></article>')
    title = "실제 손글씨 평가 포함" if document["handwriting_measured"] else "합성 인쇄체 실행 검증 — 실제 손글씨 정확도 미측정"
    page = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>CareGap OCR 비교</title><style>body{font:16px sans-serif;max-width:1200px;margin:32px auto;background:#f5f5f5}article{padding:20px;background:white;margin:16px 0}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>'
    (output / "report.html").write_text(page + f'<h1>{title}</h1><p>모든 오류율은 낮을수록 좋음. 실패는 별도 집계. 메모리는 추론 후 RSS이며 최대 사용량이 아님.</p>' + "".join(cards) + "</html>", encoding="utf-8")


def benchmark(manifest, engines, output, repeat=1, timeout=120):
    cases = load_cases(manifest)
    payloads = []
    for case in cases:
        data = (manifest.parent / case["image"]).read_bytes()
        mime = "image/png" if case["image"].lower().endswith(".png") else "image/jpeg"
        payloads.append({"mime_type": mime, "base64": base64.b64encode(data).decode("ascii")})
    rows = []
    for engine in engines:
        for run in range(repeat):
            began = time.perf_counter()
            results = run_worker(engine, payloads, timeout)
            for case, payload, result in zip(cases, payloads, results):
                row = {**result, "engine": engine, "case_id": case["id"], "kind": case["kind"], "condition": case.get("condition"), "image": case["image"], "image_sha256": case["sha256"], "reference": case["text"], "run": run + 1, "batch_wall_ms": (time.perf_counter() - began) * 1000,
                       "image_data_url": f'data:{payload["mime_type"]};base64,{payload["base64"]}'}
                if row.get("ok"):
                    row["metrics"] = evaluate(case["text"], row["text"])
                rows.append(row)
            print(engine, f"run={run+1}", f"success={sum(bool(r.get('ok')) for r in results)}/{len(cases)}", flush=True)
    summary = summarize(rows)
    report(rows, summary, output)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=ROOT / "samples" / "manifest.json")
    parser.add_argument("--engines", nargs="+", choices=ENGINES, default=ENGINES)
    parser.add_argument("--output", type=Path, default=ROOT / "results")
    parser.add_argument("--repeat", type=int, choices=range(1, 6), default=2)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    print(json.dumps(benchmark(args.manifest.resolve(), args.engines, args.output, args.repeat, args.timeout), ensure_ascii=False, indent=2))
