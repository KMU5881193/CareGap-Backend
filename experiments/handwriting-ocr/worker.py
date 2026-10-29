"""JSONL stdin/stdout protocol. Only model downloads in download_models.py use network."""
import argparse
import base64
import json
import os
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["tesseract", "paddle", "handwriting-line"], required=True)
    args = parser.parse_args()
    # Redirect even native-library stdout to stderr. Preserve original fd for protocol.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    sys.stdout.flush()
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    from providers import decode_image, load_engine
    started = time.perf_counter()
    load_error = None
    try:
        extract, model = load_engine(args.engine)
    except Exception as error:
        load_error = error
        print(f"MODEL_LOAD_FAILED: {type(error).__name__}: {error}", file=sys.stderr)
    load_ms = (time.perf_counter() - started) * 1000
    while True:
        line = sys.stdin.buffer.readline(7 * 1024 * 1024 + 1)
        if not line:
            break
        try:
            if len(line) > 7 * 1024 * 1024:
                raise ValueError("REQUEST_TOO_LARGE")
            request = json.loads(line)
            data = base64.b64decode(request["base64"], validate=True)
            image = decode_image(data, request["mime_type"])
            if load_error is not None:
                raise RuntimeError("MODEL_LOAD_FAILED")
            began = time.perf_counter()
            text = extract(image)
            if not isinstance(text, str) or len(text) > 100_000:
                raise ValueError("INVALID_RESULT")
            import psutil
            response = {"ok": True, "engine": args.engine, "model": model, "text": text,
                        "elapsed_ms": (time.perf_counter() - began) * 1000, "load_ms": load_ms,
                        "rss_bytes_after": psutil.Process().memory_info().rss}
        except Exception as error:
            code = "MODEL_LOAD_FAILED" if load_error is not None else "INFERENCE_FAILED"
            # Do not include input, filename, private error detail, or traceback in protocol.
            response = {"ok": False, "engine": args.engine, "error": code}
            print(f"{code}: {type(error).__name__}", file=sys.stderr)
        protocol.write(json.dumps(response, ensure_ascii=False) + "\n")
        if len(line) > 7 * 1024 * 1024:
            break
    protocol.close()


if __name__ == "__main__":
    main()
