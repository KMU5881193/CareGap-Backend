"""Explicit setup command, never invoked during inference. Hash-pinned public models."""
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent


def download():
    records = json.loads((ROOT / "models-manifest.json").read_text(encoding="utf-8"))
    if sum(item["bytes"] for item in records) > 1_000_000_000:
        raise ValueError("Downloads above 1GB require approval")
    for item in records:
        target = (ROOT / "models" / item["path"]).resolve()
        if not target.is_relative_to((ROOT / "models").resolve()):
            raise ValueError("Invalid model path")
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == item["sha256"]:
            data = target.read_bytes()
        else:
            if item["bytes"] > 64 * 1024 * 1024:
                raise ValueError("Per-file download limit exceeded")
            with urllib.request.urlopen(item["url"], timeout=60) as response:
                data = response.read(item["bytes"] + 1)
            if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("Model checksum or size mismatch")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        if target.suffix == ".tar":
            with tarfile.open(target) as archive:
                # Explicit paths checked in addition to Python 3.12 safe extraction filter.
                for member in archive.getmembers():
                    resolved = (ROOT / "models" / member.name).resolve()
                    if not resolved.is_relative_to((ROOT / "models").resolve()) or not (member.isfile() or member.isdir()):
                        raise ValueError("Unsafe archive entry")
                archive.extractall(ROOT / "models", filter="data")
        print(item["path"], item["bytes"], "verified")


if __name__ == "__main__":
    download()
