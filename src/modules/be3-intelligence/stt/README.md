# STT Foundation — BE3 내부 리뷰용 초안

최신 main `3f57faa`의 SttProvider, Actor, Id, AuthorizationPort를 재사용한다. PR #4/#5/#6의 미병합 구현이나 OCR 저장소·AI 워크플로를 import하지 않는다. 기존 파일·공통 계약·DB·PORT·서버는 변경하지 않았으며 이 라우터를 src/app.ts에 마운트하지 않는다.

## 파일 책임

- `wav.ts`: PCM16 WAV의 실제 RIFF/WAVE/chunk/표본율/채널/바이트율/프레임/길이 검사, 메타데이터 제거.
- `model.ts`: 전사 원문·시간 구간·익명 화자 레이블, 기존 SttProvider와 호환되는 선택적 timestamp/취소 확장.
- `service.ts`: Mock, 인스턴스별 In-memory 저장소, 작업 상태·중복 요청·권한·교정·확정 관리.
- `local-provider.ts`: 격리된 Python faster-whisper CPU subprocess 어댑터. 자동 엔진 설정·서버 마운트 없음.
- `router.ts`: 신뢰할 수 있는 BE1 세션 해석기와 서비스를 주입하는 독립 Express 라우터.

## WAV 및 로컬 제한

초기 지원은 `audio/wav`, `.wav`, RIFF little-endian PCM format 1 / 16bit이다. 단순 PCM fmt 16바이트 또는 확장 길이 0인 fmt 18바이트만 허용한다. 실제 지원 표본율은 8k/16k/22.05k/24k/32k/44.1k/48kHz, 채널은 1 또는 2다. 파일명·MIME만 믿지 않고 RIFF 크기·fmt/data 중복·chunk 경계와 패딩·byte rate·block align·data 프레임 정합성을 확인한다. ancillary chunk는 버리고 표준 PCM WAV로 정규화한다.

로컬 테스트 한도는 파일 10MiB 이하이면서 300초 이하, 라우터 JSON 14MiB, 텍스트 합계 100,000자, 구간 1,000개다. 운영 정책이나 팀 표준이 아니다. 파일명은 확장자 검사에만 사용하며 경로로 쓰지 않는다. 원본 음성은 저장·공개·로그 출력하지 않는다. 처리 중 메모리에만 보유한다. 업로드 동시 파싱의 전역 메모리 제한이나 rate limit은 없으므로 운영 노출 전 별도 설계해야 한다.

실제 local-provider는 **16kHz/mono/PCM16**만 검증했다. 다른 표본율·stereo의 자동 리샘플링은 구현하지 않았으며 실제 제공자는 안전하게 실패한다. MP3/M4A는 미지원이다. PyAV/FFmpeg 및 변환 파이프라인의 의존성·빌드별 라이선스·리소스 제한을 추가 검토한 후 별도 제안한다.

## 상태와 중복 요청

`pending → processing → succeeded | failed`. 생성 응답은 pending 스냅샷이고 조회 시 이미 processing/완료일 수 있다. 실패 코드는 `STT_PROVIDER_FAILED`, `STT_TIMEOUT`(retryable=true), `INVALID_STT_RESULT`(retryable=false)만 노출한다. 제공자 예외의 상세·경로·출력은 응답에 넣지 않는다. 타임아웃 이후 늦은 성공·실패는 상태를 바꾸지 않는다. AbortSignal을 지원하는 실제 어댑터는 취소 시 subprocess를 종료한다. 기존 2인수 SttProvider는 그대로 주입할 수 있지만 취소 신호를 무시할 수 있다.

Idempotency는 actor.user_id + STT 생성 + request_key 범위다. 같은 대상자·정규화 WAV는 기존 작업을 반환하고 같은 키의 다른 입력은 409다. 실패 작업의 같은 키 재요청은 실패 상태를 재생하며 엔진을 다시 실행하지 않는다. 자동 재시도는 없고 원인 해결 후 새 키로 요청한다. 키 보존 기간·TTL은 미정이다.

동기 insert 및 compare-and-swap으로 중복 생성·동시 교정·확정 충돌을 거부한다. 향후 DB 구현은 고유 제약과 원자적 버전 갱신을 보장해야 한다. 저장소는 테스트 인스턴스별이며 재시작하면 데이터가 사라진다. 영속 저장소·작업 큐·삭제/감사 정책은 미구현이다.

## 화자 구분의 정확한 범위

구간은 `{start_ms,end_ms,speaker_id,text}`다. 시간은 정수 ms, start>=0, end>start, 파일 길이 이내, 시간순·비중첩으로 검증한다. 겹침 발화 지원은 별도 정책이 필요하다.

- 실제 ASR이 제공한 구간은 `timing=asr_timestamps`이며 화자 전환을 뜻하지 않는다.
- 문자열만 반환하는 제공자는 녹음 전체 구간 하나에 `timing=whole_audio`로 표시한다. 임의의 단어 시각이나 음향 분석 결과를 만들지 않는다.
- **음향 기반 화자 분리는 미구현이며 항상 diarization=none이다.** 자동 출력의 speaker_id는 모두 unknown이어야 한다. 역할이나 화자를 추정해 넣은 제공자 결과는 거부한다.
- 사람이 교정 시 `unknown`, `speaker_1`~`speaker_999`를 지정할 수 있다. 익명 레이블이지 staff/person/family의 실제 신원·역할이 아니다. 담당자·대상자 역할을 자동으로 연결하거나 확정하지 않는다.
- 원본 text는 구간 text를 순서대로 빈 구분자로 연결한 값과 정확히 같아야 한다. 공백·개행을 정리하지 않고 보존한다. 교정본은 별도 구간을 줄바꿈으로 연결한 text를 가진다.

## 교정·확정 및 권한

original은 교정으로 덮어쓰지 않는다. revisions에 version/text/segments/edited_by/edited_at을 누적한다. version=0은 엔진 결과이고, 담당자가 원문을 그대로 승인할 때도 교정본 version 1을 명시적으로 제출한다. 요청 expected_version과 최신 버전이 다르면 409다. 확정 후 재교정·재확정은 이번 초안에서 거부한다.

BE1이 검증된 세션 actor와 현재 배정·관계·동의·철회를 반영하는 AuthorizationPort를 제공해야 한다. 역할만으로 접근하지 않으며 명시적인 boolean true만 승인한다. 예외는 거부한다. 생성/교정/확정은 write, 조회는 read, 확정본 전달은 analyze를 매 요청 검사한다. 위조 X-Test-Actor는 해석하지 않는다. 권한 없는 기존 ID의 403과 미존재 ID의 404를 구분하므로 존재 여부 은닉 정책은 BE1과 합의해야 한다.

`confirmedInput()`은 `{transcript_job_id,transcript_version,person_id,text,segments}`만 반환한다. 확정 전 호출은 409 NOT_CONFIRMED다. BE2가 공식 상담·기록 버전과 연결해야 하며 BE3가 record_version_id를 생성하거나 SourceVersion으로 가장하지 않는다. AI 자동 실행은 없다.

## HTTP 제안

아래는 팀 확정 계약이 아닌 `/api/transcripts` 마운트 제안이다. 실제 서버에는 미마운트다. 성공 `{data}`, 실패 `{error:{code,message}}`.

| Method | 경로 | 입력 | 응답 |
|---|---|---|---|
| POST | /api/transcripts/jobs | person_id, request_key, filename, mimeType, base64 | 202 작업 |
| GET | /api/transcripts/jobs/:id | UUID | 200 상태·버전·데이터 |
| GET | /api/transcripts/jobs/:id/result | UUID | 200 원본/구간/교정 이력, 미성공 409 |
| POST | /api/transcripts/jobs/:id/corrections | expected_version, segments | 200 새 버전 |
| POST | /api/transcripts/jobs/:id/confirmation | expected_version(양의 정수) | 200 확정 |

JSON/base64는 로컬 테스트 전송 방식이며 multipart·스트리밍은 미지원이다. base64는 큰 반복 정규식 없이 문자 검사로 검증한다. 기본 오류는 400 INVALID_REQUEST/INVALID_AUDIO/EMPTY_AUDIO/CORRUPT_WAV/UNSUPPORTED_WAV_ENCODING/UNSUPPORTED_AUDIO_FORMAT/INVALID_SEGMENTS/INVALID_ID, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT/RESULT_NOT_READY/NOT_CONFIRMED, 413 AUDIO_TOO_LARGE/AUDIO_TOO_LONG, 500 INTERNAL_ERROR다.

운영 연결 전: BE1 인증·녹음/STT 동의·철회, BE2 공식 기록 연결과 버전 변경, 화자 역할 매핑·공개 범위, 암호화·보관·삭제·감사, 전역 부하 제한·영속 큐·재시도, 실제 다화자 평가가 필요하다. 모델 설치·합성 시연·실측 결과는 `experiments/stt/README.md`를 따른다.
