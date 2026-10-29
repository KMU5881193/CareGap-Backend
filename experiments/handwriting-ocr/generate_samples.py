"""Font-rendered fixtures are NOT human handwriting. Never import personal photos."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

SENTENCES = [
    "최근 일주일 동안 식사를 하루 두 번 했다고 함.",
    "무릎이 불편하여 외출이 줄었다고 말씀하심.",
    "지난주에는 약을 복용하지 않은 날이 2일 있었다.",
    "어제는 통증이 없었다고 이야기함.",
    "다음 상담은 11월 12일 오후 2시로 안내함.",
]


def generate(font_path, output):
    font = ImageFont.truetype(str(font_path), 44)
    output.mkdir(parents=True, exist_ok=True)
    cases = []
    for index, text in enumerate(SENTENCES, 1):
        box = font.getbbox(text)
        base = Image.new("RGB", (box[2] + 80, 120), "white")
        ImageDraw.Draw(base).text((40, 25), text, font=font, fill="black")
        variants = {"print": base,
                    "slanted_print": base.rotate(6, expand=True, fillcolor="white"),
                    "dim_print": ImageEnhance.Brightness(base).enhance(0.45)}
        for variant, image in variants.items():
            name = f"synthetic-{index}-{variant}.png"
            path = output / name
            image.save(path)
            cases.append({"id": f"{index}-{variant}", "image": name, "text": text,
                          "kind": "font_print", "condition": variant,
                          "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    manifest = {"schema_version": 1, "description": "합성 인쇄체 실행 검증; 실제 손글씨 아님",
                "font_filename": Path(font_path).name,
                "font_sha256": hashlib.sha256(Path(font_path).read_bytes()).hexdigest(),
                "cases": cases}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "samples")
    args = parser.parse_args()
    generate(args.font, args.output)
