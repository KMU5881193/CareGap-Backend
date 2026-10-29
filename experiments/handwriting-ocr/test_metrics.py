import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unicodedata
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
import subprocess
from metrics import distance, evaluate, rates
from providers import decode_image
from benchmark import load_cases, report, run_worker, summarize


@contextmanager
def temporary_dir():
    root = (Path(__file__).resolve().parent / ".cache" / "tests").resolve()
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root) as directory:
        if not Path(directory).resolve().is_relative_to(root):
            raise ValueError("Test temporary directory escaped workspace")
        yield directory


class MetricsTests(unittest.TestCase):
    def test_edit_operations(self):
        self.assertEqual(distance("가나다", "가라"), 2)
        self.assertEqual(distance("", "가"), 1)
        self.assertEqual(distance("가", ""), 1)

    def test_identity(self):
        self.assertEqual(rates("어제 통증이 없었다.", "어제 통증이 없었다.")["cer"], 0)

    def test_nfc_is_separate_from_raw(self):
        result = evaluate("한글", unicodedata.normalize("NFD", "한글"))
        self.assertGreater(result["raw"]["cer"], 0)
        self.assertEqual(result["nfc"]["cer"], 0)

    def test_spaces_and_punctuation_not_deleted(self):
        result = evaluate("약 2회.", "약2회")
        self.assertEqual(result["nfc"]["char_errors"], 2)
        self.assertEqual(result["nfc"]["wer"], 1)

    def test_empty_reference_is_finite(self):
        self.assertEqual(rates("", "")["cer"], 0)
        self.assertEqual(rates("", "약")["cer"], 1)

    def test_errors_can_exceed_one(self):
        self.assertEqual(rates("가", "가나다라")["cer"], 3)

    def test_negation_and_numbers_flagged(self):
        result = evaluate("통증이 없다. 약 미복용 2일 1회", "통증이 있다. 약 복용 7일 10회")
        self.assertTrue(result["numbers"]["mismatch"])
        self.assertIn("없", [row["marker"] for row in result["keyword_changes"]])
        self.assertIn("미복용", [row["marker"] for row in result["keyword_changes"]])

    def test_date_time_and_repetition(self):
        self.assertTrue(evaluate("11월 12일 2시 2회", "11월 12일 7시 2회")["numbers"]["mismatch"])
        self.assertTrue(evaluate("2일 2일", "2일")["numbers"]["mismatch"])

    def test_failure_not_reported_as_zero_error_success(self):
        group = summarize([{"engine": "paddle", "kind": "font_print", "ok": False}])[0]
        self.assertEqual(group["failed"], 1)
        self.assertIsNone(group["nfc"])

    def test_native_windows_stderr_does_not_corrupt_utf8_protocol(self):
        response = SimpleNamespace(returncode=0, stdout=b'{"ok":false,"error":"INFERENCE_FAILED"}\n', stderr="진단".encode("cp949"))
        with patch("benchmark.subprocess.run", return_value=response):
            self.assertFalse(run_worker("paddle", [{}], 10)[0]["ok"])

    def test_batch_timeout_is_a_failure(self):
        with patch("benchmark.subprocess.run", side_effect=subprocess.TimeoutExpired("worker", 1)):
            result = run_worker("paddle", [{}, {}], 1)
        self.assertEqual([row["error"] for row in result], ["WORKER_TIMEOUT", "WORKER_TIMEOUT"])

    def test_invalid_protocol_is_a_failure(self):
        response = SimpleNamespace(returncode=0, stdout=b'not-json\n', stderr=b'private')
        with patch("benchmark.subprocess.run", return_value=response):
            self.assertEqual(run_worker("paddle", [{}], 10)[0]["error"], "WORKER_FAILED")


class SafetyTests(unittest.TestCase):
    def image(self):
        from PIL import Image
        stream = BytesIO()
        Image.new("RGB", (2, 3), "white").save(stream, format="PNG")
        return stream.getvalue()

    def test_valid_image_and_mime_mismatch(self):
        self.assertEqual(decode_image(self.image(), "image/png").size, (2, 3))
        with self.assertRaises(ValueError):
            decode_image(self.image(), "image/jpeg")

    def test_corrupt_empty_and_large_input(self):
        for value in [b"", b"not image", self.image()[:20], b"0" * (5 * 1024 * 1024 + 1)]:
            with self.assertRaises((ValueError, OSError)):
                decode_image(value, "image/png")

    def test_manifest_traversal_and_hash_rejected(self):
        with temporary_dir() as directory:
            root = Path(directory)
            case = {"id": "x", "image": "../private.png", "text": "합성", "kind": "font_print", "sha256": "0" * 64}
            path = root / "manifest.json"
            path.write_text(json.dumps({"cases": [case]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_cases(path)
            case["image"] = "local.png"
            (root / "local.png").write_bytes(self.image())
            path.write_text(json.dumps({"cases": [case]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_cases(path)

    def test_provenance_is_required(self):
        with temporary_dir() as directory:
            root = Path(directory)
            (root / "x.png").write_bytes(self.image())
            case = {"id": "x", "image": "x.png", "text": "합성", "kind": "unknown", "sha256": hashlib.sha256(self.image()).hexdigest()}
            path = root / "manifest.json"
            path.write_text(json.dumps({"cases": [case]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_cases(path)

    def test_html_escapes_model_output_and_csv_guards_formulas(self):
        with temporary_dir() as directory:
            root = Path(directory)
            row = {"engine": "test", "kind": "font_print", "case_id": "<script>", "image": "synthetic.png", "image_data_url": "data:image/png;base64," + base64.b64encode(self.image()).decode(), "reference": "=1+1", "text": "<script>alert(1)</script>", "ok": True, "metrics": evaluate("=1+1", "<script>alert(1)</script>"), "elapsed_ms": 1}
            report([row], [], root)
            rendered = (root / "report.html").read_text(encoding="utf-8")
            self.assertNotIn("<script>", rendered)
            self.assertIn("&lt;script&gt;", rendered)
            self.assertIn("'=1+1", (root / "benchmark.csv").read_text(encoding="utf-8-sig"))

    def test_worker_failure_envelope_for_invalid_image(self):
        # Invalid payload is rejected before inference even if no local models exist.
        result = run_worker("tesseract", [{"mime_type": "image/png", "base64": "bm90LWltYWdl"}], 30)
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]["ok"])
        self.assertNotIn("text", result[0])


if __name__ == "__main__":
    unittest.main()
