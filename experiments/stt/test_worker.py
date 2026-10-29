from io import BytesIO
from pathlib import Path
import unittest
import wave
from worker import infer


def fixture(rate=16000, channels=1, width=2):
    stream = BytesIO()
    with wave.open(stream, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(width)
        output.setframerate(rate)
        output.writeframes(b"\0" * rate * channels * width)
    return stream.getvalue()


class WorkerInputTests(unittest.TestCase):
    def test_empty_audio(self):
        with self.assertRaisesRegex(ValueError, "INVALID_AUDIO_SIZE"):
            infer(b"", Path("missing-model"))

    def test_oversized_audio(self):
        with self.assertRaisesRegex(ValueError, "INVALID_AUDIO_SIZE"):
            infer(b"x" * (10 * 1024 * 1024 + 1), Path("missing-model"))

    def test_corrupt_audio(self):
        with self.assertRaises((EOFError, wave.Error)):
            infer(b"not a WAV", Path("missing-model"))

    def test_real_engine_profile_is_explicit(self):
        for rate, channels, width in [(48000, 1, 2), (16000, 2, 2), (16000, 1, 1)]:
            with self.subTest(rate=rate, channels=channels, width=width):
                with self.assertRaisesRegex(ValueError, "REQUIRES_16KHZ_MONO_PCM16"):
                    infer(fixture(rate, channels, width), Path("missing-model"))

    def test_missing_model_is_not_auto_downloaded(self):
        with self.assertRaisesRegex(ValueError, "LOCAL_MODEL_MISSING"):
            infer(fixture(), Path(__file__).resolve().parent / ".cache" / "missing-model")

    def test_truncated_pcm(self):
        with self.assertRaisesRegex(ValueError, "TRUNCATED_PCM"):
            infer(fixture()[:-4], Path("missing-model"))


if __name__ == "__main__":
    unittest.main()
