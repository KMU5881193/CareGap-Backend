"""Offline CPU ASR only. ASR timestamps are NOT acoustic speaker diarization."""
import argparse
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import wave


def infer(data, model_dir):
    if not data or len(data) > 10 * 1024 * 1024:
        raise ValueError("INVALID_AUDIO_SIZE")
    with wave.open(BytesIO(data), "rb") as stream:
        if stream.getnchannels() != 1 or stream.getsampwidth() != 2 or stream.getframerate() != 16000:
            raise ValueError("REAL_PROVIDER_REQUIRES_16KHZ_MONO_PCM16")
        frames = stream.getnframes()
        if not 0 < frames <= 300 * 16000:
            raise ValueError("INVALID_AUDIO_DURATION")
        pcm = stream.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError("TRUNCATED_PCM")
    for name in ("model.bin", "config.json", "tokenizer.json"):
        if not (model_dir / name).is_file():
            raise ValueError("LOCAL_MODEL_MISSING")
    import numpy as np
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=2,
                         num_workers=1, local_files_only=True)
    samples = np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0
    raw, _ = model.transcribe(samples, language="ko", beam_size=5, vad_filter=False,
                              condition_on_previous_text=False)
    duration_ms = (frames * 1000 + 15999) // 16000
    segments = []
    for item in raw:
        start = max(0, round(item.start * 1000))
        end = min(duration_ms, round(item.end * 1000))
        if end <= start or not item.text.strip():
            raise ValueError("INVALID_ASR_SEGMENT")
        segments.append({"start_ms": start, "end_ms": end, "speaker_id": "unknown", "text": item.text})
    # Preserve exactly the ASR text returned by the engine; no proofreading.
    return {"text": "".join(item["text"] for item in segments), "segments": segments,
            "timing": "asr_timestamps", "diarization": "none"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["OMP_NUM_THREADS"] = "2"
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    sys.stdout.flush()
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    try:
        data = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
        result = infer(data, args.model_dir.resolve())
        protocol.write(json.dumps(result, ensure_ascii=False) + "\n")
        protocol.flush()
    except Exception as error:
        print(f"STT_WORKER_FAILED: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
    finally:
        protocol.close()


if __name__ == "__main__":
    main()
