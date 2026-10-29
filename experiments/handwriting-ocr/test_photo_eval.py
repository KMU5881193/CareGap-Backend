from contextlib import contextmanager
from pathlib import Path
import json
import tempfile
import unittest
import unicodedata
from PIL import Image
from benchmark import load_cases
from photo_eval import ROOT, checked_output, critical_checks, load_config, mark_errors, prepare, render, transform


@contextmanager
def local_files():
    with tempfile.TemporaryDirectory(dir=ROOT, prefix="results-test-photo-") as directory:
        path = Path(directory).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError("Temporary path escaped experiment")
        yield path


def fixture(root):
    Image.new("RGB", (160, 80), "white").save(root / "test.png")
    config = {"source_image": "test.png", "ground_truth_verified": True,
              "lines": [{"id": "line-1", "box": [0, 0, 150, 70], "text": "가상 기록 두번"}]}
    path = root / "config.json"
    path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    return config, path


class PhotoReviewTests(unittest.TestCase):
    def test_requires_explicit_ground_truth_review(self):
        with local_files() as root:
            config, path = fixture(root)
            config["ground_truth_verified"] = False
            path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "ground truth"):
                load_config(path)

    def test_generic_benchmark_also_rejects_unverified_human_reference(self):
        with local_files() as root:
            _, config = fixture(root)
            inputs = prepare(config, root / "results-output")
            path = inputs / "manifest-lines.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            document["cases"][0]["ground_truth_verified"] = False
            path.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "verified ground truth"):
                load_cases(path)

    def test_enforces_private_output(self):
        for path in [ROOT, ROOT / "public-photo", ROOT.parent / "results-outside"]:
            with self.assertRaises(ValueError):
                checked_output(path)

    def test_rejects_source_traversal_and_bad_crops(self):
        with local_files() as root:
            config, path = fixture(root)
            for box in [[-1, 0, 10, 10], [0, 0, 200, 80], [1, 1, 1, 1], [0, 0, 1.5, 2]]:
                config["lines"][0]["box"] = box
                path.write_text(json.dumps(config), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_config(path)
            config["source_image"] = "../private.png"
            path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_config(path)

    def test_same_verified_text_is_reused_for_all_variants(self):
        with local_files() as root:
            config, path = fixture(root)
            inputs = prepare(path, root / "results-output")
            raw = load_cases(inputs / "manifest-lines.json")
            variants = load_cases(inputs / "manifest-variants.json")
            self.assertEqual(len(variants), 3)
            self.assertTrue(all(row["text"] == config["lines"][0]["text"] for row in raw + variants))
            self.assertTrue(all(row["ground_truth_verified"] is True for row in raw + variants))

    def test_engine_independent_preprocessing_is_deterministic(self):
        image = Image.new("RGB", (200, 100), (180, 180, 180))
        self.assertEqual(transform(image, "height96").size, (192, 96))
        self.assertEqual(transform(image, "contrast160").size, (320, 160))
        self.assertEqual(transform(image, "contrast96").tobytes(), transform(image, "contrast96").tobytes())

    def test_report_rejects_results_for_another_image_or_reference(self):
        with local_files() as root:
            _, path = fixture(root)
            destination = root / "results-output"
            prepare(path, destination)
            for name in ("baseline-full", "baseline-lines", "variants"):
                directory = destination / name
                directory.mkdir()
                rows = [{"condition": "raw_line_crop", "image_sha256": "wrong-photo", "reference": "unverified reference"}] if name == "baseline-lines" else []
                (directory / "benchmark.json").write_text(json.dumps({"rows": rows}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "verified photo manifest"):
                render(path, destination)

    def test_diff_escapes_html_and_marks_insertions_and_omissions(self):
        text = mark_errors("없다 <script>", "있다 <img>")
        self.assertNotIn("<script>", text)
        self.assertNotIn("<img>", text)
        self.assertIn("<del", text)
        self.assertIn("<ins", text)

    def test_critical_flags_do_not_claim_semantic_equivalence(self):
        line = {"checks": [{"field": "가상 핵심 표현", "expected": ["두번", "않", "2일"]}]}
        result = critical_checks(line, "두 번 했으나 7일")
        self.assertEqual(result[0]["missing"], ["않", "2일"])
        self.assertEqual(critical_checks({"checks": [{"field": "NFC", "expected": ["없"]}]}, unicodedata.normalize("NFD", "없"))[0]["missing"], [])


if __name__ == "__main__":
    unittest.main()
