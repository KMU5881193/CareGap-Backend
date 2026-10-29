# 한국어 STT CPU 실험 및 로컬 데모

별도 Git worktree `CareGap-Backend-STT`, 브랜치 `feature/ai-stt-foundation`, 최신 main `3f57faa`에서 시작했다. OCR 원본 폴더의 브랜치를 전환하지 않았으며 PR #4/#5/#6에 의존하지 않는다. 아래 명령은 STT worktree 루트에서 실행한다.

## 후보와 실제 검증 범위

- **실행함:** faster-whisper 1.2.1 / CTranslate2 4.8.4, Systran/faster-whisper-base `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`, CPU int8·2 threads·beam 5·language ko. 코드·모델은 MIT를 명시한다. [공식 구현](https://github.com/SYSTRAN/faster-whisper), [모델 카드](https://huggingface.co/Systran/faster-whisper-base), [라이선스](https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE).
- **조사만 함:** [Vosk 한국어 small 0.22](https://alphacephei.com/vosk/models)는 공식 목록에서 82MB, Apache-2.0, 로컬 한국어 경량 모델로 안내한다. 이번 작업에서 설치·추론·성능 비교하지 않았다.
- **미구현:** 음향 기반 화자 분리 모델·speaker embedding·화자 수 추정·역할 식별. ASR 시각 구간과 화자 레이블 교정은 음향 diarization이 아니다.

검증 환경은 Windows x64 / PowerShell 7 / Python 3.12.6 격리 가상환경이다. 시스템 Python·음성·FFmpeg를 설치하거나 바꾸지 않았다. 설치된 Microsoft Heami 한국어 SAPI TTS로 가상 문장 한 개(두 문장)를 생성했다. 사람 상담 녹음·실제 다화자·잡음 환경의 정확도와 타임스탬프 정확도는 미측정이다.

## 설치와 재현

```powershell
py -3.12 -m venv experiments/stt/.venv
$python = (Resolve-Path experiments/stt/.venv/Scripts/python.exe).Path
& $python -m pip install --index-url https://pypi.org/simple --only-binary=:all: --require-hashes -r experiments/stt/requirements-windows.lock
& $python -m pip check
& $python -X utf8 experiments/stt/download_models.py
& experiments/stt/generate-synthetic.ps1
& $python -X utf8 experiments/stt/check_inference.py
```

24개 CPU Python 휠 합계 86,531,820바이트, 모델 4파일 합계 147,882,941바이트를 사전에 확인했다. 개별 및 합계 1GB 이상 모델은 승인 없이 받지 않는다. 모델 URL·리비전·파일 크기·SHA-256은 models-manifest.json에 고정했다. Windows CPython 3.12 휠은 requirements-windows.lock에 버전·해시를 고정했다. 다른 OS/Python의 설치·실제 추론은 미검증이며 별도 환경에서 설치 계획부터 확인해야 한다.

SAPI의 한국어 음성이 이미 설치돼 있을 때만 샘플을 생성한다. 없으면 스크립트가 중단하며 자동 시스템 음성 설치나 외부 TTS를 하지 않는다. 음성 파일·가상환경·모델·캐시·설치 계획·상세 결과는 Git에서 제외한다. 개인정보가 없는 실제 합성 파일만 로컬에서 사용한다. 공개한 synthetic-result.json은 오디오가 없는 소규모 합성 텍스트 기록이다.

faster-whisper의 간접 의존성 PyAV 19.0.2는 BSD-3-Clause를 명시하며 네이티브 FFmpeg 라이브러리를 포함한다. [PyAV 공식 설치 문서](https://pyav.org/docs/stable/overview/installation.html)도 휠의 FFmpeg 연결을 안내한다. FFmpeg 라이선스는 빌드 구성과 포함 코덱에 따라 별도 확인해야 한다. 이 실험은 Python wave와 NumPy로 PCM16 WAV를 직접 읽고 FFmpeg 실행파일·MP3/M4A 변환 기능을 노출하지 않는다. MP3/M4A 지원·바이너리 재배포는 의존성/빌드 라이선스 검토 후 별도 제안한다.

## 실제 합성 음성 결과

입력: 16kHz / mono / PCM16, 6.185초, Microsoft Heami 단일 음성. 정답:

`최근 식사는 하루 두 번 했습니다. 어제는 통증이 없었습니다.`

실제 ASR 원문(선행 공백 포함):

```json
{"text":" 최근 식사는 하루 두 번 했습니다. 어제는 통증이 없었습니다.","segments":[{"start_ms":0,"end_ms":3400,"speaker_id":"unknown","text":" 최근 식사는 하루 두 번 했습니다."},{"start_ms":3400,"end_ms":6185,"speaker_id":"unknown","text":" 어제는 통증이 없었습니다."}],"timing":"asr_timestamps","diarization":"none"}
```

실측 한 번의 프로세스 시작·모델 로드 포함 시간은 약 4.62초였다. 정확도 점수·실제 상담 성능·다화자 분리 성공률을 만들어 내지 않았다. ASR 시각은 ms로 반올림하고 입력 길이 안으로 제한하며 잘못된 구간은 실패 처리한다. 화자는 모두 unknown이다. 이 두 구간을 두 사람의 발화로 해석하면 안 된다.

## 팀원용 서비스 데모

외부 모델이나 음성 없이 Mock 흐름:

```powershell
pnpm exec tsx experiments/stt/demo.ts mock
```

실제 합성 한국어 음성 흐름:

```powershell
$env:STT_PYTHON = $python
pnpm exec tsx experiments/stt/demo.ts real
```

둘 다 입력 → 작업 → 원문/구간 조회 → 사람 교정 version 1 → 확정 → 확정본 전달을 실행한다. 데모의 speaker_1은 사람이 지정한 익명 레이블이고 실제 화자 분리·역할 판정 결과가 아니다. 합성 actor/person 한 쌍에만 권한을 주는 로컬 어댑터를 사용하며 HTTP 서버는 열지 않는다. 합성 결과만 콘솔에 출력한다. 실제 운영 서비스는 원문을 로그에 출력하지 않는다.

실제 엔진은 16kHz mono PCM16만 사용한다. 서버 입력 검증은 다른 표본율·stereo PCM16도 검사할 수 있지만 이 제공자에는 아직 리샘플링이 없어 실패한다. 프로세스는 신뢰할 수 있는 절대 Python·모델·worker 경로, 인수 배열, shell=false, windowsHide로 실행한다. 오디오는 binary stdin, 결과는 UTF-8 JSON stdout, 진단은 stderr로 분리한다. 입력 10MiB·stdout 1MiB·stderr 64KiB·동시 실행 1개·기본 90초 제한 및 취소 시 프로세스 종료를 적용한다. 종료 확인 전 슬롯을 재사용하지 않는다.

기존 문자열 SttProvider는 호환된다. 서비스 기본 timeout 10초와 달리 실제 데모는 제공자 90초보다 긴 95초를 명시적으로 주입한다. 운영 정책을 바꾼 것이 아니다. 전역 큐·부하 제한·영속 저장소는 없고 개별 제공자 인스턴스의 제한만 있다. 음성 파일을 subprocess 어댑터에서 저장하지 않는다. 실험 samples/results의 보관·삭제는 개발자가 관리한다.

## 검증

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
git diff --check
& $python -X utf8 -m unittest discover -s experiments/stt -p 'test_*.py' -v
```

Vitest는 WAV·상태·타임아웃·늦은 응답·권한 철회·원문 불변·교정 이력·화자/시간·동시 수정·확정·HTTP·프로세스 경계를 검증한다. Python 테스트는 의존성/모델 없이 잘못된 입력과 16kHz mono 경계·모델 자동 다운로드 금지를 검사한다. 실제 모델 추론은 Windows 로컬에서 별도 검증했고 기존 GitHub Node CI는 실제 모델을 다운로드하지 않는다.

최종 로컬 결과: Vitest **95개 PASS**(main 기존 23개 + STT 72개), Python **6개 PASS**. pnpm 고정 잠금 설치·타입 검사·빌드·git diff --check, Python 해시 고정 설치·pip check·모델 해시 검증, Mock/실제 STT 교정·확정 데모를 통과했다. WAV 시그니처는 ASCII 마스킹 없이 실제 바이트로 비교하며 상위 비트 위장 회귀도 포함한다.

운영 BE1 인증/녹음·STT 동의/철회, BE2 공식 기록 버전 연동, 실제 대화/다화자 평가, 음향 diarizer, 겹침 발화, 리샘플링, 영속 큐·보관·삭제·감사·공개 정책은 남아 있다. 서비스 계약 초안은 src/modules/be3-intelligence/stt/README.md를 따른다. 실제 녹음의 부정어·숫자 누락 및 무음 구간의 잘못된 전사도 담당자 검토 대상이며 자동으로 사실·공식 기록으로 확정하지 않는다.
