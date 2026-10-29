"""Verified local photo evaluation. Images, manifests and reports stay gitignored."""
import argparse
import base64
from difflib import SequenceMatcher
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import unicodedata
from PIL import Image, ImageOps
from benchmark import benchmark, summarize
from providers import decode_image

ROOT = Path(__file__).resolve().parent
VARIANTS = ("height96", "contrast96", "contrast160")


def checked_output(path):
    path = path.resolve()
    if not path.is_relative_to(ROOT) or not path.relative_to(ROOT).parts or not path.relative_to(ROOT).parts[0].startswith("results"):
        raise ValueError("Photo artifacts must stay inside the gitignored results directories")
    return path


def load_config(path):
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("ground_truth_verified") is not True:
        raise ValueError("Confirm literal ground truth before measuring CER/WER")
    source = (path.parent / config["source_image"]).resolve()
    if not source.is_relative_to(path.parent.resolve()) or source.suffix.lower() not in (".png", ".jpg", ".jpeg"):
        raise ValueError("Source photo must stay inside the selected config directory")
    if not 0 < source.stat().st_size <= 5 * 1024 * 1024:
        raise ValueError("Photo must be nonempty and below 5 MiB")
    data = source.read_bytes()
    image = decode_image(data, "image/png" if source.suffix.lower() == ".png" else "image/jpeg")
    lines = config["lines"]
    if not 1 <= len(lines) <= 50:
        raise ValueError("Use 1..50 reviewed lines")
    ids = set()
    for line in lines:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", line["id"]) or line["id"] in ids:
            raise ValueError("Invalid or duplicate line ID")
        box = line["box"]
        if len(box) != 4 or any(type(value) is not int for value in box):
            raise ValueError("Crop coordinates must be four integers")
        x0, y0, x1, y1 = box
        if not (0 <= x0 < x1 <= image.width and 0 <= y0 < y1 <= image.height):
            raise ValueError("Crop must stay inside the oriented image")
        if not isinstance(line["text"], str) or not 1 <= len(line["text"]) <= 10_000:
            raise ValueError("Invalid literal ground truth")
        ids.add(line["id"])
    return config, source, image


def transform(image, variant):
    height = 160 if variant == "contrast160" else 96
    if variant.startswith("contrast"):
        image = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=1)
    return image.resize((max(1, round(image.width * height / image.height)), height), Image.Resampling.LANCZOS).convert("RGB")


def prepare(config_path, output):
    output = checked_output(output)
    config, source, image = load_config(config_path)
    inputs = output / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    original = inputs / ("original" + source.suffix.lower())
    shutil.copyfile(source, original)
    cases, variants = [], []
    for line in config["lines"]:
        crop = image.crop(line["box"])
        for condition in ("raw_line_crop",) + VARIANTS:
            target = inputs / f'{line["id"]}-{condition}.png'
            (crop if condition == "raw_line_crop" else transform(crop, condition)).save(target)
            case = {"id": line["id"] if condition == "raw_line_crop" else f'{line["id"]}@{condition}',
                    "image": target.name, "text": line["text"], "kind": "human_handwriting",
                    "condition": condition, "ground_truth_verified": True,
                    "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}
            (cases if condition == "raw_line_crop" else variants).append(case)
    full = {"id": "full-board", "image": original.name,
            "text": "\n".join(f'{i}. {line["text"]}' for i, line in enumerate(config["lines"], 1)),
            "kind": "human_handwriting", "condition": "full_photo", "ground_truth_verified": True,
            "sha256": hashlib.sha256(original.read_bytes()).hexdigest()}
    for name, values in (("lines", cases), ("variants", variants), ("full", [full])):
        (inputs / f"manifest-{name}.json").write_text(json.dumps({"schema_version": 1, "cases": values}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return inputs


def mark_errors(reference, actual):
    chunks = []
    for operation, a, b, c, d in SequenceMatcher(None, reference, actual, autojunk=False).get_opcodes():
        old, new = html.escape(reference[a:b]), html.escape(actual[c:d])
        if operation == "equal": chunks.append(new)
        else:
            if old: chunks.append(f'<del title="정답에서 누락·변경">{old}</del>')
            if new: chunks.append(f'<ins title="실제 OCR의 삽입·변경">{new}</ins>')
    return "".join(chunks)


def critical_checks(line, actual):
    # Whitespace-insensitive lexical screening only; never changes CER/WER text.
    compact = re.sub(r"\s+", "", unicodedata.normalize("NFC", actual))
    return [{"field": check["field"], "expected": check["expected"],
             "missing": [token for token in check["expected"] if re.sub(r"\s+", "", unicodedata.normalize("NFC", token)) not in compact]}
            for check in line.get("checks", [])]


def render(config_path, output):
    output = checked_output(output)
    config, source, _ = load_config(config_path)
    rows = []
    for dataset in ("baseline-full", "baseline-lines", "variants"):
        document = json.loads((output / dataset / "benchmark.json").read_text(encoding="utf-8"))
        rows.extend({**row, "dataset": dataset} for row in document["rows"])
    # Refuse stale reports for a different photo, crop, transform or transcription.
    expected = []
    for name in ("full", "lines", "variants"):
        expected.extend(json.loads((output / "inputs" / f"manifest-{name}.json").read_text(encoding="utf-8"))["cases"])
    for row in rows:
        matches = [case for case in expected if case["condition"] == row["condition"]
                   and case["sha256"] == row["image_sha256"] and case["text"] == row["reference"]]
        if len(matches) != 1:
            raise ValueError("Result does not match the verified photo manifest")
    groups = []
    for condition in sorted({row["condition"] for row in rows}):
        selected = [row for row in rows if row["condition"] == condition]
        for item in summarize(selected):
            own = [row for row in selected if row["engine"] == item["engine"] and row["ok"]]
            item.update(condition=condition, worker_load_ms=own[0].get("load_ms") if own else None)
            groups.append(item)
    workflows = []
    workflow_dir = output / "workflows"
    if workflow_dir.exists():
        workflows = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(workflow_dir.glob("*.json"))]
    summary = {"photo_count": 1, "line_count": len(config["lines"]), "ground_truth_verified": True,
               "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "groups": groups,
               "human_correction_time_ms": None, "workflows": workflows}
    (output / "photo-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    table = []
    for group in groups:
        metrics = group["nfc"]
        cer = f'{metrics["cer"]:.2%}' if metrics else "미측정"
        wer = f'{metrics["wer"]:.2%}' if metrics else "미측정"
        infer = f'{group["mean_inference_ms"]:.1f}' if group["mean_inference_ms"] is not None else "—"
        load = f'{group["worker_load_ms"]:.1f}' if group["worker_load_ms"] is not None else "—"
        table.append(f'<tr><td>{html.escape(group["condition"])}</td><td>{html.escape(group["engine"])}</td><td>{group["succeeded"]}/{group["attempts"]}</td><td>{cer}</td><td>{wer}</td><td>{infer}</td><td>{load}</td><td>{group["numeric_mismatches"]}</td><td>{group["keyword_flagged"]}</td></tr>')
    cards = []
    for row in rows:
        line = next((line for line in sorted(config["lines"], key=lambda item: -len(item["id"]))
                     if row["case_id"] == line["id"] or row["case_id"].startswith((line["id"] + "@", line["id"] + "-"))), None)
        flags = critical_checks(line, row.get("text", "")) if line else []
        warnings = "".join('<li>' + html.escape(check["field"]) + ': ' + ("확인 필요 — " + html.escape(", ".join(check["missing"])) if check["missing"] else "표현 존재 — 의미 판정 아님") + '</li>' for check in flags)
        rate = f'{row["metrics"]["nfc"]["cer"]:.2%}' if row.get("metrics") else "미측정"
        cards.append(f'<details><summary>{html.escape(row["engine"])} / {html.escape(row["condition"])} / {html.escape(row["case_id"])} — CER {rate}</summary><article><img src="{html.escape(row["image_data_url"], quote=True)}" alt="실제 손글씨 입력"><div class="pair"><section><b>검증 정답</b><pre>{html.escape(row["reference"])}</pre></section><section><b>실제 추출 원문</b><pre>{html.escape(row.get("text", ""))}</pre></section></div><ul>{warnings}</ul><b>오류 정렬: 빨강=정답에서 누락·변경 / 초록=OCR 삽입·변경</b><pre>{mark_errors(row["reference"], row.get("text", ""))}</pre><details><summary>세부 오류 데이터</summary><pre>{html.escape(json.dumps({"ok": row["ok"], "error": row.get("error"), "metrics": row.get("metrics"), "critical_checks": flags}, ensure_ascii=False, indent=2))}</pre></details></article></details>')
    reviews = []
    for workflow in workflows:
        reviews.append('<article><h3>기존 OcrService 교정·확정 실증</h3><pre>' + html.escape(json.dumps(workflow, ensure_ascii=False, indent=2)) + '</pre></article>')
    mime = "image/png" if source.suffix.lower() == ".png" else "image/jpeg"
    picture = f'data:{mime};base64,' + base64.b64encode(source.read_bytes()).decode("ascii")
    truths = "".join(f'<li>{html.escape(line["text"])}</li>' for line in config["lines"])
    page = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>CareGap 실제 손글씨 비교</title><style>body{font:16px system-ui;background:#f1f4f7;max-width:1280px;margin:32px auto;color:#172033}article,header{background:white;padding:24px;margin:20px 0;border-radius:12px}img{max-width:100%;height:auto}table{border-collapse:collapse;background:white;width:100%}th,td{border:1px solid #ccd5df;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}del{background:#ffd6d6;color:#8d1111}ins{background:#d2f3dc;color:#13532b;text-decoration:none}li{margin:8px 0}.notice{background:#fff3ce;padding:16px}</style>'''
    page += '<header><h1>실제 한국어 손글씨 OCR · 로컬 시연</h1><p>첨부된 실제 사진 1장 / 검증한 정답 / 동일한 줄 crop을 세 엔진에 입력</p><p class="notice">공백·문장부호 포함 raw와 NFC를 모두 저장합니다. 오류율은 낮을수록 좋으며 삽입이 많으면 100%를 넘습니다. 이 사진에 맞춘 전처리 탐색이며 일반 성능 보장이 아닙니다. ONNX 전체 페이지 추론은 하지 않았습니다.</p>'
    page += f'<img src="{picture}" alt="원본 손글씨 화이트보드"><h2>사진 그대로 확인한 정답</h2><ol>{truths}</ol></header>'
    page += '<h2>동일 조건 비교</h2><p>추론 평균은 이미지별 처리 시간, 모델 로드는 작업자 1회 초기화 시간입니다. 여러 조건이 작업자를 공유하므로 로드 시간을 이미지마다 합산하지 마세요. 전체 사진의 정답에는 목록 번호가 있고 줄 crop에는 번호가 없습니다. 각 조건 내부에서 엔진끼리 비교하며, 전처리 전후의 줄 정답은 동일합니다. 숫자·핵심표현 경고는 재검토 신호이며 의미 반전을 확정하는 판정이 아닙니다.</p><table><tr><th>입력 조건</th><th>엔진</th><th>실행</th><th>NFC CER</th><th>NFC WER</th><th>추론 ms</th><th>로드 ms</th><th>숫자 경고</th><th>표지 경고</th></tr>' + "".join(table) + '</table>'
    page += '<h2>교정·확정</h2><p>아래는 실제 OcrService가 만든 버전 1·확정 결과입니다. 검증된 정답을 제출한 자동 시연이며 사람의 교정 소요 시간은 측정하지 않았습니다.</p>' + ("".join(reviews) or '<p>아직 워크플로 결과 파일이 없습니다.</p>')
    page += '<h2>원문·누락·숫자·부정어 확인</h2>' + "".join(cards) + '</html>'
    (output / "report.html").write_text(page, encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "results-photo")
    parser.add_argument("--phase", choices=["prepare", "run", "report", "all"], default="all")
    args = parser.parse_args()
    output = checked_output(args.output)
    if args.phase in ("prepare", "all"):
        prepare(args.config.resolve(), output)
    if args.phase in ("run", "all"):
        for name, engines in (("full", ["tesseract", "paddle"]), ("lines", ["tesseract", "paddle", "handwriting-line"]), ("variants", ["tesseract", "paddle", "handwriting-line"])):
            benchmark(output / "inputs" / f"manifest-{name}.json", engines,
                      output / ("variants" if name == "variants" else "baseline-" + name), repeat=1, timeout=240)
    if args.phase in ("report", "all"):
        print(json.dumps(render(args.config.resolve(), output), ensure_ascii=False, indent=2))
