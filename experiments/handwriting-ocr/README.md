# BE3 한국어 OCR 로컬 비교 실험 (2단계)

**초기 공개 평가 결과는 합성 인쇄체 실험이다.** 해당 실행 검증은 Windows 맑은 고딕으로 렌더링한 가상 상담 문장만 사용했다. 기울인 폰트 이미지도 손글씨가 아니다. 후속 실제 손글씨 사진은 아래 `photo_eval.py`로 별도 평가하며 사진·정답·개별 결과·보고서는 로컬에 유지한다. 두 데이터 종류의 점수를 섞지 않는다. 실제 엔진 추론과 기존 OCR 서비스의 교정·확정 흐름을 검증했으며 Mock 반환값을 정확도 측정에 사용하지 않는다.

PR #4가 열린 상태에서 `origin/feature/ai-ocr-foundation`을 기준으로 만든 후속 작업이다. PR #4를 병합하지 않으며 종속 PR은 해당 브랜치를 대상으로 한다. Foundation 병합 후 main과 변경 차이를 재확인해 PR 대상을 조정한다.

## 환경과 설치

검증 환경: Windows x64, Python 3.12, Node.js 22.15.0, pnpm 11.25.0. 시스템 기본 Python 3.13과 운영 서버는 변경하지 않는다. Python 의존성은 이 폴더의 `.venv`에만 설치한다.

저장소 루트 PowerShell에서:

```powershell
py -3.12 -m venv experiments/handwriting-ocr/.venv
$python = (Resolve-Path experiments/handwriting-ocr/.venv/Scripts/python.exe).Path
& $python -m pip install --index-url https://pypi.org/simple --only-binary=:all: --require-hashes -r experiments/handwriting-ocr/requirements-windows.lock
& $python -m pip check
& $python -X utf8 experiments/handwriting-ocr/download_models.py
& $python -X utf8 experiments/handwriting-ocr/generate_samples.py --font C:/Windows/Fonts/malgun.ttf
& $python -X utf8 experiments/handwriting-ocr/benchmark.py --repeat 2
```

`requirements-windows.lock`는 CPython 3.12 / Windows x64 휠 SHA-256까지 고정한 전이 의존성 목록이다. 최초 CPU 패키지 설치 계획은 73개 휠 약 243MB였고 ONNX Runtime·flatbuffers 약 15MB를 추가했다. 모델 다운로드는 합계 39,244,390바이트(약 39MB)다. 모델은 개별 64MiB 및 합계 1GB 제한, 실제 크기·SHA-256 검사를 거친다. 모든 URL·해시는 `models-manifest.json`에 있다. 다운로드는 명시적인 setup 명령에서만 실행한다.

`requirements.txt`는 직접 의존성 버전을 설명한다. Linux/macOS 및 다른 Python 버전에서는 Windows 전용 해시 잠금 파일을 그대로 사용하지 않는다. 별도 환경에서 직접 의존성으로 설치 계획을 확인해야 하며 이번 작업에서 해당 환경의 실제 엔진 추론은 미검증이다. tesserocr의 네이티브 의존성 때문에 시스템 패키지가 필요할 수 있지만, 이번 작업은 Windows 공식 PyPI 휠을 사용해 시스템 설치를 하지 않았다.

글꼴 파일은 재배포하지 않는다. 다른 PC에서 다른 한국어 글꼴을 쓰면 렌더링과 정확도 결과가 달라질 수 있다. 생성 manifest의 글꼴 파일명·해시와 이미지 해시를 비교해야 한다.

## 엔진 후보와 근거

| 후보 | 실제 사용한 모델·버전 | 실행 및 한국어 범위 | 손글씨·라이선스 검토 |
|---|---|---|---|
| Tesseract | tesserocr 2.12.0에 포함된 Tesseract 5.5.3, tessdata_fast `8741641`, kor+eng, LSTM, PSM 6 | 로컬 CPU, Windows 휠로 실행 | 인쇄체 기준선. 손글씨 성능 보장 없음. Tesseract·tessdata Apache-2.0, tesserocr MIT |
| PaddleOCR | PaddleOCR 3.7.0 / PaddlePaddle 3.3.1, PP-OCRv5_mobile_det + korean_PP-OCRv5_mobile_rec | 한국어·영어·숫자 지원. CPU 검출+인식 실행 | 공식 한국어 모델은 약 14MB. 일반 PP-OCRv5의 손글씨 설명을 한국어 손글씨 성능으로 일반화하지 않음. 코드 Apache-2.0 |
| 한국어 손글씨 특화 후보 | Rebeccaaaaaaaa/korean-handwriting-rec `f12ca8b`, 14,790,116바이트 ONNX, ONNX Runtime 1.31.1 | 단일 줄 인식 전용 CPU 실행. 사전 11,945개 항목 중 한글 음절 11,172개 확인 | 작성자는 AI Hub 기반 손글씨·공문서 미세조정과 모델/코드 Apache-2.0을 명시. 학습 데이터 조건의 서비스 적용은 별도 검토 필요. 자체 광고 성적은 CareGap 측정치로 쓰지 않음 |

공식/작성자 원문 확인일: 2026-10-29. 모델 파일의 고정 리비전·해시가 재현 기준이며 upstream의 미래 변경을 자동 반영하지 않는다. 특화 후보는 공개 저장소·모델 파일·추론 안내·라이선스가 존재하는 것을 확인했다. 장기 유지보수나 한국어 상담지 성능을 보장하지 않는다. 추가 후보 `jysvai/ko-hand-ocr`도 검토했으나 이번에는 작은 실제 실행 후보 세 개에 집중해 설치·실험하지 않았다.

출처:

- [Tesseract 설치·라이선스](https://tesseract-ocr.github.io/tessdoc/Installation.html), [tesserocr](https://github.com/sirfz/tesserocr), [고정 언어 데이터](https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd)
- [PaddleOCR 공식 모델 설명](https://www.paddleocr.ai/main/en/version3.x/module_usage/text_recognition.html), [Windows CPU 및 Python 지원](https://www.paddlepaddle.org.cn/documentation/docs/en/install/pip/windows-pip_en.html), [PaddleOCR 라이선스](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)
- [손글씨 특화 후보 작성자 저장소](https://github.com/VerifiedIdiot/korean-handwriting-rec), [고정 모델 리비전](https://huggingface.co/Rebeccaaaaaaaa/korean-handwriting-rec/tree/f12ca8b5e2e26a90f1f5188d993fe69e699a27df), [추가 조사 후보](https://github.com/jysvai/ko-hand-ocr)

Paddle의 공식 Windows 문서는 Python 3.9~3.13을 안내하지만 이 실험에서 확인한 조합은 3.12뿐이다. 사전 한국어 범위가 넓다는 사실은 모든 글자의 인식 정확도를 뜻하지 않는다. 일반 사진 검출+인식은 Paddle과 Tesseract로 비교할 수 있지만 `handwriting-line`은 잘린 한 줄만 받으므로 페이지 전체용 엔진과 같다고 설명하지 않는다.

## 데이터와 평가 방식

가상 문장 5개 × 일반·6도 회전·밝기 45% 인쇄체 = 서로 다른 이미지 15장이다. 각 엔진을 2번 실행한 90회 추론은 이미지 90장이 아니다. 실제 손으로 또박또박 쓴 글씨·흘림체·촬영 그림자 사진은 준비되지 않았다. 생성 문장은 식사, 외출, 미복용·부정 표현, 날짜·숫자·시각을 포함한다.

- CER: 유니코드 코드포인트 Levenshtein 거리 / 정답 글자 수. 공백·문장부호·개행도 포함한다.
- WER: 공백으로 분리한 토큰의 Levenshtein 거리 / 정답 토큰 수. 공백의 위치 차이는 CER에도 남는다.
- `raw`와 NFC 정규화 결과를 모두 보관한다. NFC 외 공백·문장부호 삭제나 NFKC 정규화는 하지 않는다. 빈 정답 분모는 1로 정의한다. 오류율은 삽입이 많으면 100%를 넘을 수 있다.
- 집계는 성공한 요청의 오류 수/정답 길이를 합산한 micro CER/WER이며, 실패 수를 별도 표시한다. 실패를 0% 오류로 계산하지 않는다.
- 숫자·단위·날짜·시각 토큰 비교와 있다/없다/않/복용/미복용/증상 변화 표지의 빈도 차이를 별도 표시한다. 이는 검토 경고이며 의미 반전이나 의학적 사실을 확정하는 판정기가 아니다.
- inference 시간은 모델 로드 후 이미지 추론 시간이다. load_ms와 batch_wall_ms도 보관한다. 첫 추론은 warm-up 비용이 섞일 수 있다. rss_bytes_after는 추론 직후 프로세스 RSS이며 최대 사용량이 아니다.

실측 결과는 [EVALUATION.md](./EVALUATION.md)와 이미지 payload를 뺀 `evaluation-summary.json`을 본다. 상세 JSON·CSV·이미지와 나란히 보는 독립 HTML 보고서는 `results/`에 생성하며 Git에는 올리지 않는다. HTML은 외부 리소스·스크립트가 없고 OCR 텍스트를 escape한다. CSV는 수식 실행을 방지한다.

## 실제 손글씨 샘플을 받았을 때

사용자가 직접 쓴 가상 상담 문장의 사진만 별도 로컬 폴더에 둔다. 개인정보·기존 개인 PoC 이미지를 자동 탐색하거나 복사하지 않는다. 폴더 안에 다음 구조의 `manifest.json`을 만들고 실제 SHA-256을 기록한다. 인쇄체를 `human_handwriting`으로 표기하면 안 된다.

```json
{"schema_version":1,"cases":[{"id":"human-1","image":"synthetic-handwriting.png","text":"어제는 통증이 없었다고 이야기함.","kind":"human_handwriting","condition":"neat_handwriting","ground_truth_verified":true,"sha256":"실제 이미지 SHA-256"}]}
```

```powershell
& $python -X utf8 experiments/handwriting-ocr/benchmark.py --manifest C:/path/to/synthetic-only/manifest.json --output experiments/handwriting-ocr/results-handwriting --engines tesseract paddle --repeat 2
```

이미지는 manifest 폴더 내부 JPEG/PNG, 각 5MiB 이하·한 배치 합계 32MiB 이하만 허용한다. base64 전송의 추가 메모리를 제한하기 위한 로컬 실험 한도다. 입력 해시·출처 구분·중복 ID를 검증한다. 한 줄 특화 모델을 비교하려면 동일한 줄 crop을 모든 엔진에 넣고 별도 실험임을 기록한다. 생성 보고서에는 이미지와 원문이 포함되므로 사용자 제공 폴더·보고서를 공개 저장소에 추가하지 않는다.

### 실제 사진 시연 도구

`photo_eval.py`는 기존 benchmark를 재사용해 전체 사진(Tesseract/Paddle), 번호를 제외한 동일 줄 crop(세 엔진), 높이 96px·대비 조정 96px/160px 전처리를 분리한다. 모든 엔진에 같은 픽셀·같은 정답을 적용하며 원문을 교정해 점수를 개선하지 않는다. 사람 손글씨는 직접 확인한 정답과 `ground_truth_verified: true`가 있어야 점수를 계산한다. 띄어쓰기·숫자·문장부호가 애매하면 작성자에게 먼저 확인한다.

개인 사진 옆의 로컬 `photo-config.json` 형식:

```json
{"source_image":"photo.png","ground_truth_verified":true,"lines":[{"id":"line-1","box":[10,20,900,180],"text":"사진에서 직접 확인한 가상 문장","checks":[{"field":"가상 핵심 표현","expected":["확인할 표현"]}]}]}
```

box는 EXIF 방향 보정 후 이미지의 정수 좌표 `[left,top,right,bottom]`이다. 번호를 제외하되 글자를 자르지 않도록 직접 확인한다. 출력은 Git에서 제외한 experiment `results*` 폴더만 허용한다. 실제 사용자 사진·crop·설정·정답·원문·보고서는 로컬에 두며 저장소에는 일반 도구·합성 단위 테스트만 추가한다.

```powershell
& $python -X utf8 experiments/handwriting-ocr/photo_eval.py --config experiments/handwriting-ocr/samples/my-photo/photo-config.json --output experiments/handwriting-ocr/results-photo
```

기본 실행은 준비→실제 추론→보고서 생성이다. `--phase prepare`, `--phase run`, `--phase report`로 단계별 실행할 수도 있다. 보고서는 원본 사진·정답·원문·CER/WER·숫자/부정표지·모델 로드/추론 시간·문자 차이를 보여준다. `<details>`를 열어 엔진·줄·조건별 결과를 확인한다. 사진 1장에서 고른 전처리가 다른 필자나 촬영에도 통한다고 일반화하지 않는다. 전체 사진의 목록 번호 포함 정답과 줄 crop의 번호 제외 정답은 별도 조건이다.

기존 `demo.ts`는 선택적 다섯 번째 인수로 `results*` 안의 workflow JSON 경로를 받을 수 있다. 이 파일을 사진 보고서 출력 폴더의 `workflows/`에 두고 `--phase report`를 다시 실행하면 실제 OcrService 교정 version 1·확정 결과가 합쳐진다. 정답을 제출한 자동 시연과 사람이 편집한 실측 소요 시간을 구분하며 후자는 미측정이면 null이다. 서비스의 입력 검증이 이미지를 재인코딩하므로 직접 benchmark 원문과 서비스 실행 원문은 각각 보존해 구분한다.

```powershell
pnpm exec tsx experiments/handwriting-ocr/demo.ts handwriting-line <줄-crop.png> '<확인한 교정문>' experiments/handwriting-ocr/results-photo/workflows/review.json
& $python -X utf8 experiments/handwriting-ocr/photo_eval.py --config experiments/handwriting-ocr/samples/my-photo/photo-config.json --output experiments/handwriting-ocr/results-photo --phase report
```

## 기존 서비스에 연결한 로컬 데모

```powershell
$env:OCR_PYTHON = $python
pnpm exec tsx experiments/handwriting-ocr/demo.ts tesseract
pnpm exec tsx experiments/handwriting-ocr/demo.ts paddle
pnpm exec tsx experiments/handwriting-ocr/demo.ts handwriting-line
# 추가 인수: 이미지 경로, 담당자가 확인한 교정 텍스트
```

세 명령 모두 실제 엔진으로 합성 사진 → OCR 원문 조회 → 교정 version 1 → 확정 → 확정본 전달을 로컬 실행했다. `PythonOcrProvider`는 기존 OcrProvider를 구현한다. Mock과 기존 서비스·라우터·AI 검증 코드는 변경하지 않는다. 서버를 열지 않으며 합성 actor/person만 현재 관계 검사에 통과하도록 데모 내부 어댑터를 주입한다. 데모 출력은 시험용 합성 텍스트이며 운영 코드에서는 상담 원문을 로그에 출력하지 않는다.

프로세스 실행은 신뢰할 수 있는 설정의 절대 Python/worker 경로와 고정 엔진 enum만 받는다. 셸 문자열을 실행하지 않고 인수 배열·windowsHide를 사용한다. 이미지가 stdin JSONL, 결과가 stdout UTF-8 JSONL이며 Python/native 진단은 별도 stderr로 보낸다. Windows 네이티브 로그의 CP949도 결과 UTF-8 해석을 오염시키지 않는다. Node 어댑터는 입력 5MiB·stdout 512KiB·stderr 64KiB·기본 동시 실행 1개·기본 60초 제한을 적용하고 초과 시 프로세스를 종료한다. 슬롯은 종료 확인 전 재사용하지 않는다. HTTP 입력으로 실행 경로나 인수를 지정해서는 안 된다.

기존 OcrService의 기본 5초는 모델 cold load보다 짧다. 데모는 제공자 60초보다 긴 서비스 타임아웃 65초를 명시적으로 주입한다. 운영 타임아웃·포트 정책을 변경한 것은 아니다. 제공자 인스턴스별 제한은 여러 인스턴스나 CLI 전체의 메모리 상한이 아니며, 운영에는 단일 작업자/큐·전역 부하 제한·시스템 수준 격리가 필요하다. 각 호출에서 모델을 다시 로드하는 안전한 개발용 구현이므로 장기 실행 worker보다 느리다. 이미지 파일을 생성·저장하지 않고 메모리로만 전달한다. 실험용 samples/results의 보관·삭제는 개발자가 관리한다.

## 테스트 및 미연결 경계

```powershell
& $python -X utf8 -m unittest discover -s experiments/handwriting-ocr -p 'test_*.py' -v
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Python 테스트는 CER/WER·NFC·숫자/부정 표지·입력 검증·경로/해시·보고서 escape·실패 처리를 검증한다. Vitest는 셸 비사용·인수 배열·분할 UTF-8·출력 상한·시간 초과 종료·동시성·프로토콜/프로세스 오류를 외부 모델 없이 검증한다. 실제 모델 추론은 benchmark와 demo의 별도 로컬 검증이다. 기존 GitHub Node CI는 Python 모델 추론을 실행하지 않는다.

운영 DB, BE1 실제 인증·관계·동의 검사, BE2 공식 상담 기록/RecordVersion, 운영 서버 라우터 마운트는 여전히 미연결이다. API·포트·공통 DB 정책은 확정하지 않는다. OCR 결과를 자동 확정하거나 AI 사실 근거로 바로 전달하지 않는다. 실제 손글씨 시험 후 실패 유형·표/줄 분할·숫자/부정어 교정 시간과 데이터 사용 조건을 검토해야 엔진을 선정할 수 있다.
