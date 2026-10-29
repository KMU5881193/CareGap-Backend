"""Local CPU engines. No network calls, credentials, or input image persistence."""
from io import BytesIO
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(ROOT / ".cache" / "paddlex"))
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")


def decode_image(data, mime_type):
    from PIL import Image, ImageOps
    if not data or len(data) > 5 * 1024 * 1024:
        raise ValueError("INVALID_IMAGE_SIZE")
    if mime_type not in ("image/jpeg", "image/png"):
        raise ValueError("INVALID_IMAGE_TYPE")
    with Image.open(BytesIO(data)) as source:
        expected = "JPEG" if mime_type == "image/jpeg" else "PNG"
        if source.format != expected or source.width * source.height > 16_000_000:
            raise ValueError("INVALID_IMAGE")
        source.load()
        return ImageOps.exif_transpose(source).convert("RGB")


def load_engine(name):
    if name == "tesseract":
        import tesserocr
        api = tesserocr.PyTessBaseAPI(path=str(ROOT / "models" / "tessdata"),
                                   lang="kor+eng", oem=tesserocr.OEM.LSTM_ONLY,
                                   psm=tesserocr.PSM.SINGLE_BLOCK)
        def extract(image):
            api.SetImage(image)
            return api.GetUTF8Text()
        return extract, f"{tesserocr.tesseract_version().splitlines()[0]}; tessdata_fast 8741641; kor+eng; psm=6"
    if name == "paddle":
        for model in ("PP-OCRv5_mobile_det_infer", "korean_PP-OCRv5_mobile_rec_infer"):
            for filename in ("inference.json", "inference.pdiparams", "inference.yml"):
                if not (ROOT / "models" / model / filename).is_file():
                    raise ValueError("LOCAL_MODEL_MISSING")
        import numpy as np
        from paddleocr import PaddleOCR
        engine = PaddleOCR(
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_detection_model_dir=str(ROOT / "models" / "PP-OCRv5_mobile_det_infer"),
            text_recognition_model_name="korean_PP-OCRv5_mobile_rec",
            text_recognition_model_dir=str(ROOT / "models" / "korean_PP-OCRv5_mobile_rec_infer"),
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_textline_orientation=False, device="cpu", enable_mkldnn=False,
        )
        def extract(image):
            output = list(engine.predict(input=np.asarray(image)[:, :, ::-1].copy()))
            return "\n".join(text for page in output for text in page["rec_texts"])
        return extract, "PaddleOCR 3.7.0; PP-OCRv5_mobile_det + korean_PP-OCRv5_mobile_rec; Paddle 3.3.1 CPU"
    if name == "handwriting-line":
        import math
        import numpy as np
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        session = ort.InferenceSession(str(ROOT / "models" / "handwriting" / "rec_korean_hw.onnx"),
                                       sess_options=opts, providers=["CPUExecutionProvider"])
        chars = [""] + (ROOT / "models" / "handwriting" / "ppocrv5_korean_dict.txt").read_text(encoding="utf-8").splitlines() + [" "]
        def extract(image):
            # Recognition-only: caller supplies a single cropped line. No page detection.
            height = 48
            width = max(320, min(4096, math.ceil(height * image.width / image.height)))
            resized_width = min(width, math.ceil(height * image.width / image.height))
            pixels = np.asarray(image.resize((resized_width, height)))[:, :, ::-1].astype("float32")
            pixels = (pixels / 255.0 - 0.5) / 0.5
            tensor = np.zeros((1, 3, height, width), dtype="float32")
            tensor[0, :, :, :resized_width] = pixels.transpose(2, 0, 1)
            output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
            if output.shape[-1] != len(chars):
                raise ValueError("DICTIONARY_MISMATCH")
            indices = output.argmax(axis=2)[0]
            return "".join(chars[int(value)] for i, value in enumerate(indices)
                           if value != 0 and (i == 0 or value != indices[i - 1]))
        return extract, "Rebeccaaaaaaaa/korean-handwriting-rec f12ca8b; ONNX Runtime 1.31.1 CPU; single-line only"
    raise ValueError("UNKNOWN_ENGINE")
