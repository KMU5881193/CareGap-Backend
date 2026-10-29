"""Evaluate one generated TTS WAV locally. Results contain no audio payload."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time
import wave

ROOT = Path(__file__).resolve().parent


def main():
    source = ROOT / "samples" / "synthetic-ko.wav"
    data = source.read_bytes()
    with wave.open(str(source), "rb") as stream:
        info = {"sample_rate": stream.getframerate(), "channels": stream.getnchannels(),
                "bits_per_sample": stream.getsampwidth() * 8,
                "duration_ms": stream.getnframes() * 1000 / stream.getframerate()}
    started = time.perf_counter()
    process = subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "worker.py"), "--model-dir", str(ROOT / "models" / "base")],
                             input=data, capture_output=True, timeout=90,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if process.returncode:
        raise RuntimeError("Local worker failed; no successful inference claimed")
    output = json.loads(process.stdout.decode("utf-8"))
    report = {"input_kind": "single_voice_synthetic_TTS", "voice": "Microsoft Heami Desktop - Korean",
              "reference": "최근 식사는 하루 두 번 했습니다. 어제는 통증이 없었습니다.",
              "audio_sha256": hashlib.sha256(data).hexdigest(), "audio": info,
              "engine": "faster-whisper", "engine_version": importlib.metadata.version("faster-whisper"),
              "model": "Systran/faster-whisper-base", "model_revision": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
              "compute": "CPU int8, 2 threads, beam 5, language ko, VAD disabled",
              "wall_ms_including_startup": (time.perf_counter() - started) * 1000,
              "result": output, "acoustic_diarization_tested": False,
              "real_conversation_accuracy_measured": False}
    destination = ROOT / "results"
    destination.mkdir(exist_ok=True)
    (destination / "synthetic-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
