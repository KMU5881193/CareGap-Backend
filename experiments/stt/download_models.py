"""Explicit local setup only, never called by the HTTP API or inference worker."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent


def download():
    items = json.loads((ROOT / "models-manifest.json").read_text(encoding="utf-8"))
    if sum(item["bytes"] for item in items) >= 1_000_000_000:
        raise ValueError("Downloads >=1GB require approval")
    target_root = (ROOT / "models" / "base").resolve()
    for item in items:
        path = (target_root / item["path"]).resolve()
        if not path.is_relative_to(target_root) or item["bytes"] >= 1_000_000_000:
            raise ValueError("Invalid model path or size")
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            with urllib.request.urlopen(item["url"], timeout=60) as response:
                data = response.read(item["bytes"] + 1)
            if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("Model size/checksum mismatch")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        print(item["path"], item["bytes"], "verified")


if __name__ == "__main__":
    download()
