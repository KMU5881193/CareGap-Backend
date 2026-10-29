"""Codepoint CER and whitespace-token WER. NFC only; no punctuation deletion."""
import re
import unicodedata


def distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, left in enumerate(reference, 1):
        current = [i]
        for j, right in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def rates(reference, hypothesis):
    chars = distance(reference, hypothesis)
    words = distance(reference.split(), hypothesis.split())
    return {"char_errors": chars, "reference_chars": len(reference),
            "word_errors": words, "reference_words": len(reference.split()),
            "cer": chars / max(1, len(reference)),
            "wer": words / max(1, len(reference.split()))}


def evaluate(reference, hypothesis):
    ref = unicodedata.normalize("NFC", reference)
    hyp = unicodedata.normalize("NFC", hypothesis)
    numbers = lambda text: re.findall(r"\d+(?:[.:/-]\d+)*(?:\s*[년월일시분회])?", text)
    # Screening flags, not a semantic determination or medical interpretation.
    markers = ["있", "없", "않", "안 ", "복용", "미복용", "통증", "줄었", "늘었"]
    return {"raw": rates(reference, hypothesis), "nfc": rates(ref, hyp),
            "numbers": {"reference": numbers(ref), "hypothesis": numbers(hyp),
                        "mismatch": numbers(ref) != numbers(hyp)},
            "keyword_changes": [{"marker": marker, "reference_count": ref.count(marker),
                                 "hypothesis_count": hyp.count(marker)}
                                for marker in markers if ref.count(marker) != hyp.count(marker)]}
