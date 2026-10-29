# FE–BE3 개발용 미리보기 인수인계

## 바로 실행

Integration 폴더에서 Node 22.12+ 및 프로젝트 고정 pnpm을 사용한다. 기존 잠금 의존성이 없다면 먼저 `corepack pnpm install --frozen-lockfile`을 실행한다.

```powershell
Set-Location C:\Users\Owner\Documents\Codex\CareGap-Backend-Integration
$env:CAREGAP_SYNTHETIC_PREVIEW = '1'
corepack pnpm exec tsx scripts/be3-preview-server.ts
```

이 비밀값이 아닌 opt-in 플래그만 읽는다. `.env`, API 키, 운영 config는 로드하지 않는다. 정확한 `1`이 없으면 서버를 시작하지 않는다. 고정 `127.0.0.1:4313`에서만 듣고 포트/host 변경 입력은 받지 않는다. 종료는 Ctrl+C. 새 시연은 서버 재시작으로 초기화한다. 한 서버가 하나의 공유 합성 시나리오를 보유하므로 동시에 여러 시연자가 조작하지 않는다.

FE 개발 브라우저는 같은 PC의 `http://localhost:<FE포트>` 또는 `http://127.0.0.1:<FE포트>`에서 실행한다. HTTP loopback Origin만 CORS로 허용한다. credentials나 인증 헤더를 보내지 않는다. 실제 로그인/관계 권한 완료 표시를 하지 않는다. HTTPS FE는 혼합 콘텐츠 제약이 있으므로 로컬 HTTP FE 또는 FE 개발 서버의 동일 PC 프록시를 사용한다.

```javascript
const base = 'http://127.0.0.1:4313/preview';
async function preview(path, body) {
  const response = await fetch(`${base}/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.code ?? 'PREVIEW_REQUEST_FAILED');
  return json;
}
const scenario = await preview('scenario');
```

시작 확인만 하려면 PowerShell: `Invoke-RestMethod http://127.0.0.1:4313/preview/scenario`.

휴대폰의 127.0.0.1은 휴대폰 자신이다. 이번 서버는 LAN 바인딩/터널/공개 서버를 제공하지 않는다. Android USB 시연은 별도 승인 후 `adb reverse tcp:4313 tcp:4313` 및 앱의 개발용 네트워크 정책을 검토하거나, 모바일 화면에 아래 정적 JSON을 앱 번들로 포함하는 방식을 권장한다. iOS/원격 기기는 정적 fixture 시연 또는 별도 합의된 인증·격리 시연 환경이 필요하다. 임의 0.0.0.0 바인딩은 사용하지 않는다.

## 사용할 수 있는 API의 구분

현재 실제 실행 가능한 개발 API는 아래 `/preview/*`다. `src/app.ts`와 `src/server.ts`는 변경하지 않았고 업무용 `/api/*` 및 preview 경로를 운영 앱에 추가하지 않았다. 기존 BE3 업무 라우터는 구현돼 있으나 운영 앱에는 미마운트다. 아래 업무용 경로를 운영 서버에서 호출할 수 있다고 가정하면 안 된다.

Preview는 기존 OcrService/TranscriptService/AnalysisWorkflow/AnalysisWelfareBridge/WelfareRecommendationService를 직접 재사용한다. 실제 API 인증 adapter와 업로드 수신을 우회하는 개발 fixture adapter이며, 기존 업무 라우터를 그대로 마운트한 서버는 아니다.

모든 JSON 응답에 다음 메타데이터가 있다(OPTIONS는 본문 없는 204):
```json
{"demo_mode":true,"data_origin":"synthetic","providers":{"ocr":"mock","stt":"mock","analysis":"mock"},"authentication":"fixed_synthetic_actor_only","authorization":"synthetic_fixture_check_only","records":"code_owned_fixture_not_official_be2_storage","catalog":"synthetic_demo"}
```

성공은 메타데이터 + `{data:...}`. 추천은 추가 `{connection:...}`. 오류는 메타데이터 + `{error:{code,message}}`. 고정 내부 fixture 외 사용자 ID/상담 원문/파일명/base64/파일/수정 문장을 받지 않는다. 모든 POST는 application/json, 최대 2KB, 명시된 키만 허용한다. 실제 개인정보로 거부를 시험하지 말고 합성 sentinel을 사용한다. query parameter도 거부한다. 알 수 없는 경로는 404다.

## 화면별 호출 순서와 실제 preview 계약

| 화면/동작 | Method·`/preview/` 뒤 경로 | JSON 요청 | data 응답 |
| --- | --- | --- | --- |
| 합성 시나리오/상태 | GET `scenario` | 없음 | actor/records/ocr/stt/analysis/needs/corrections/connection |
| OCR 시작 | POST `ocr/jobs` | `{}` | 202 OcrJob(기존 작업이 있으면 같은 작업) |
| OCR 원문·결과 | GET `ocr/result` | 없음 | OcrJob, 처리 중도 200이므로 status polling |
| OCR 고정 교정안 적용 | POST `ocr/corrections` | `{"expected_version":0}` | OcrJob version 1, corrections 누적 |
| OCR 확정 | POST `ocr/confirmation` | `{"expected_version":1}` | confirmed.version 1 |
| STT 시작 | POST `stt/jobs` | `{}` | 202 TranscriptJob |
| STT 원문·구간 | GET `stt/result` | 없음 | TranscriptJob, status polling |
| STT 고정 교정/화자 적용 | POST `stt/corrections` | `{"expected_version":0}` | revisions, 익명 speaker_1 수동 교정 |
| STT 확정 | POST `stt/confirmation` | `{"expected_version":1}` | confirmed.version 1 |
| 상담 비교 초안 | POST `analyses` | `{"source":"ocr"}` 또는 `{"source":"stt"}` | 분석 작업(status/original/edited/sources/review_state/version) |
| 분석 상태·근거 | GET `analysis` | 없음 | 분석 작업 |
| 고정 질문 수정 | POST `analysis/reviews` | `{"action":"edit","expected_version":1}` | version 2, 이력 |
| 검토 제출 | POST `analysis/reviews` | `{"action":"submit","expected_version":2}` | review, version 3 |
| 승인 또는 반려 | POST `analysis/reviews` | `{"action":"approve","expected_version":3}` 또는 reject | approved/rejected, version 4 |
| 승인본 화면 | GET `analysis/published` | 없음 | 승인본 draft/input/review_state/version |
| 필요 영역 확인 | POST `needs/confirmation` | `{"needs":["meal_support","mobility_support","medication_management"],"confirmed":true}` | 선택 목록·확인자 |
| 복지 카드 | POST `welfare-recommendations` | `{}` | 기존 복지 후보 결과와 connection |

edit은 선택 단계다. 생략하면 submit expected_version=1, approve=2다. FE는 언제나 실제 응답 version을 사용한다. 고정 교정/질문 수정만 제공하므로 임의 텍스트 편집을 전송하지 않는다. STT 화자 unknown→speaker_1도 고정 합성 담당자 선택이며 음향 분리 결과가 아니다.

먼저 OCR 또는 STT를 succeeded까지 조회하고 교정/확정한다. 둘 다 할 필요는 없지만 선택한 source는 확정돼야 분석이 생성된다. 분석은 그 뒤 별도의 기존 코드 소유 과거/현재 fixture를 읽는다. **OCR/STT 확인 gate는 연결돼 있지만 BE2 공식 저장을 거쳐 생성된 기록 버전은 아니다.** 이 경계를 화면의 합성 시연 안내에 표시한다. 자동 분석은 없다.

분석 초안·제출·승인은 workflow를 실제 실행한다. FE 승인 버튼의 시연 actor는 고정 staff이며 실제 담당자 인증이 아니다. 필요 확인은 승인 이후에만 허용한다. 체크박스를 미리 선택하지 않고 담당자가 식사·이동·복약 중 필요한 항목을 명시적으로 확인하게 한다. 임의 need 코드는 거부한다. 서버의 고정 시나리오 매핑은 선택 항목을 승인본의 해당 finding과 현재 원문 인용에 연결하고 bridge를 호출한다.

예: 식사만 확인하면 meal_support만 추천에 전달하며 나머지 두 영역을 자동 추가하지 않는다. 지역/연령은 null, 소득은 unknown으로 유지한다. 예전 승인 상태를 클라이언트에서 보내거나 직접 person_id를 지정할 수 없다.

## JSON fixture와 표시 데이터

`examples/preview/screens.synthetic.json`은 이 서버의 실제 서비스 실행 응답을 캡처한 정적 파일이다. 14개 screen key를 제공한다:

- scenario, ocr_original, ocr_corrected, ocr_confirmed
- stt_original, stt_corrected, stt_confirmed
- analysis_draft, analysis_edited, analysis_review, analysis_approved, published
- needs_confirmed, welfare_cards

각 screen 값이 preview의 전체 JSON envelope다. snapshot UUID/시각은 캡처 세션 값이며 실제 서버 요청 인자로 사용하지 않는다. 현재 세션 ID는 GET scenario에서 확인한다. 새 캡처를 콘솔에서 재현하려면 `corepack pnpm exec tsx scripts/be3-preview-fixtures.ts`를 실행한다. 이 명령은 localhost 테스트 요청으로 합성 단계를 실행하고 JSON만 출력한다.

OCR 예시(축약):
```json
{"demo_mode":true,"data_origin":"synthetic","data":{"status":"succeeded","provider_kind":"mock","version":1,"original":"최근 식사를 자주 거르고 있다고 말씀하심. 다리가 불편하여 장보기가 어렵다고 함.","corrections":[{"version":1,"text":"최근 일주일 동안 식사를 하루 두 번 했다고 함. 무릎 통증으로 외출하지 못했다고 함. 약을 복용하지 않은 날이 2일 있었다고 함."}],"confirmed":{"version":1}}}
```

STT 원본 예시(축약):
```json
{"demo_mode":true,"data_origin":"synthetic","data":{"status":"succeeded","provider_kind":"mock","version":0,"original":{"text":"합성 테스트: 최근 식사는 하루 두 번 했습니다.","segments":[{"start_ms":0,"end_ms":1000,"speaker_id":"unknown","text":"합성 테스트: 최근 식사는 하루 두 번 했습니다."}],"timing":"whole_audio","diarization":"none"}}}
```

분석 finding 예시(전체 data.original/edited.findings의 일부):
```json
{"text":"식사 횟수: 하루 3회 → 하루 2회로 기록됨.","change":"worsened","evidence":[{"consultation_id":"00000000-0000-4000-8000-000000000003","record_version_id":"00000000-0000-4000-8000-000000000004","quote":"지난주에는 하루 세 끼 식사를 했다고 함."},{"consultation_id":"00000000-0000-4000-8000-000000000005","record_version_id":"00000000-0000-4000-8000-000000000006","quote":"최근 일주일 동안 식사를 하루 두 번 했다고 함."}]}
```

후보 카드 예시(필드 축약, 원본 전체는 welfare_cards.data):
```json
{"program_id":"demo-meal","program_name":"[합성] 식사 지원 연결 테스트","eligibility_status":"unverified","matched_needs":["meal_support"],"region_match":"unknown","missing_information":["거주지역 확인 필요","연령대 확인 필요","소득·수급 관련 조건 확인 필요"],"source_url":null,"checked_at":null,"data_status":"synthetic_demo","warning":"합성 시연 전용이며 실제 제도·혜택이 아닙니다."}
```

FE 표시 규칙:
- original은 덮어쓰지 않고 교정본·교정자·시각·version과 나란히 표시한다. version 0은 담당자 교정 전이며 confirmed가 있어야 확정이다.
- 분석 draft.status는 승인 뒤에도 draft이고 review_state가 실제 승인 상태다. original/edited/history를 구분하고 원문 인용을 함께 표시한다.
- worsened는 합성 기록의 변화 라벨이며 건강 악화/진단/위험도를 뜻하지 않는다. 인용 검증도 의미·의료 정확성을 보증하지 않는다.
- STT unknown은 화자 미확인이다. 사람의 익명 speaker_1 라벨을 담당자/대상자 신원으로 바꾸지 않는다.
- 추천 사유, matched_needs, basis(사업 조건), connection.confirmations[].evidence(상담 인용), 출처/확인일, missing_information, warning/disclaimer를 구분해 표시한다.
- preview는 전부 Mock OCR/STT/분석 + 합성 사업이다. 실제 모델 설치·실행은 이번 서버에 없다. 기존 `experiments/stt/synthetic-result.json`은 별도의 실제 엔진·합성 음성 실험 기록이며 이 API의 결과로 표시하지 않는다. `examples/analysis/llm-mock-http.json`도 가짜 HTTP 예시다.
- 실제 OCR 실험은 `experiments/handwriting-ocr/EVALUATION.md`의 제한된 별도 실측이다. 이번 preview가 인식 성능을 검증한 것으로 표현하지 않는다.
- 공식 카탈로그는 별도 officialWelfareCatalog에만 존재한다. preview는 이를 섞지 않는다. verified_official은 사업 안내 snapshot 확인이며 개인 자격 승인이 아니다. 모든 후보의 eligibility_status=unverified를 유지한다.

## 기존 업무 라우터 계약: 구현됨, 운영 미마운트

성공 `{data}`, 실패 `{error:{code,message}}`. 아래 OCR/STT의 `/api/ocr`, `/api/transcripts`는 마운트 제안 prefix이며 실제 router 내부는 `/jobs`부터 시작한다. 분석·복지 router는 `/api/...` 전체 경로를 가진다. 운영 조립 시 전역 256KB parser와 각 router 제한, 마지막 404 및 다른 router의 전역 인증/parser 간섭을 해결해야 한다.

| 기능 | 구현된 Method·경로(제안 prefix 포함) | 입력 JSON·응답 |
| --- | --- | --- |
| OCR 생성 | POST `/api/ocr/jobs` | `{person_id,request_key,filename,mimeType,base64}` → 202 OcrJob |
| OCR 상태/결과 | GET `/api/ocr/jobs/:id`, `/:id/result` | 없음 → 200 OcrJob, result는 미성공 시 409 |
| OCR 교정/확정 | POST `/:id/corrections`, `/:id/confirmation` | `{expected_version,text}` / `{expected_version}` → 갱신 작업 |
| STT 생성 | POST `/api/transcripts/jobs` | OCR과 같은 필드, PCM16 WAV → 202 TranscriptJob |
| STT 상태/결과 | GET `/api/transcripts/jobs/:id`, `/:id/result` | 없음 → 작업 및 original/segments/revisions |
| STT 교정/확정 | POST `/:id/corrections`, `/:id/confirmation` | `{expected_version,segments:[{start_ms,end_ms,speaker_id,text}]}` / `{expected_version}` |
| 분석 생성 | POST `/api/analyses` + Idempotency-Key | `{person_id,past:[{consultation_id,record_version_id}],current:{consultation_id,record_version_id}}` → 200 작업 |
| 분석 조회/승인본 | GET `/api/analyses/:id`, `/:id/published` | 작업 / `{id,input,provider_kind,review_state,draft,version}` |
| 검토 | POST `/api/analysis-reviews/:id` | `{action,expected_version,draft?}`; action edit/submit/approve/reject |
| 복지 목록/상세 | GET `/api/welfare-programs`, `/:id` | query q/need/region/age_group/data_status/limit/offset → programs/total/next_offset/disclaimer 또는 program |
| 구조화 필요 추천 | POST `/api/welfare-recommendations` | `{person_id,needs,region,age_group,income_status}` → person_id/algorithm/candidates/unmatched_needs/disclaimer |
| 승인본 기반 필요 확인/추천 | `AnalysisWelfareBridge.recommend` 메서드만 | `{analysis_id,expected_analysis_version,confirmations:[{need,finding_index,evidence_index,confirmed:true}]}` → `{data,connection}`; **업무 HTTP 경로 미구현** |

업무 요청 JSON 예시는 `docs/BE3-INTEGRATION-PREVIEW.md` 및 각 모듈의 OCR-DRAFT.md / stt/README.md / ANALYSIS-DRAFT.md / WELFARE-DRAFT.md에 있다. 응답 필드는 위 fixture에서 실제 서비스 형태를 확인할 수 있지만 preview metadata는 업무 라우터 계약에 포함되지 않는다. 기존 개인 추천 API는 독립 구조화 입력용이므로 승인 분석 검사를 대신하지 않는다.

## 상태·오류와 FE 실패 처리

작업 상태는 OCR/STT pending→processing→succeeded/failed다. failed 시 data.failure.code/retryable 표시. 분석은 running/succeeded/failed와 별도 draft→review→approved/rejected 상태를 가진다. HTTP 200이어도 data.status=failed이면 성공 화면을 표시하지 않는다.

Preview에서 주요 오류:
- 시작 거부 PREVIEW_OPT_IN_REQUIRED: opt-in을 켠 명령으로 실행.
- 400 PREVIEW_INVALID_REQUEST: 고정 스키마/합성 preset으로 다시 요청; 민감한 사용자 입력 재전송 금지.
- 403 PREVIEW_HOST_REJECTED/PREVIEW_ORIGIN_REJECTED: 같은 PC HTTP loopback 개발 주소 확인.
- 415 PREVIEW_JSON_REQUIRED, 413 PREVIEW_BODY_TOO_LARGE: application/json 및 작은 단계 명령만 전송.
- 409 PREVIEW_STAGE_REQUIRED: 앞선 생성/분석 단계 실행.
- 409 NOT_CONFIRMED: OCR/STT 교정 후 확정 필요.
- 409 NOT_APPROVED: 분석 제출 후 담당자 승인 필요.
- 409 NEEDS_NOT_CONFIRMED: 승인 후 체크박스 선택·확인 필요.
- 409 CONFLICT: GET scenario로 최신 version 재조회. 확정/승인/반려 후 재수정은 불가. 새 시연은 재시작.
- 500 PREVIEW_INTERNAL_ERROR: 원문·요청 본문을 로그에 넣지 말고 고정 오류 안내 후 서버 담당자에게 알림.

기존 업무 서비스 추가 오류(운영 미마운트):
- 공통 400 INVALID_REQUEST/INVALID_ID, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT, 500 INTERNAL_ERROR.
- OCR: 400 INVALID_IMAGE/EMPTY_IMAGE/INVALID_SIGNATURE/MIME_MISMATCH/EXTENSION_MISMATCH/CORRUPT_IMAGE, 413 IMAGE_TOO_LARGE, 409 RESULT_NOT_READY/NOT_CONFIRMED. 실패 data는 PROVIDER_FAILED/PROVIDER_TIMEOUT/INVALID_PROVIDER_RESULT.
- STT: 400 INVALID_AUDIO/EMPTY_AUDIO/CORRUPT_WAV/UNSUPPORTED_WAV_ENCODING/UNSUPPORTED_AUDIO_FORMAT/INVALID_SEGMENTS, 413 AUDIO_TOO_LARGE/AUDIO_TOO_LONG, 409 RESULT_NOT_READY/NOT_CONFIRMED. 실패 data는 STT_PROVIDER_FAILED/STT_TIMEOUT/INVALID_STT_RESULT.
- 분석: 409 SOURCE_MISMATCH/EVIDENCE_CHANGED/NOT_APPROVED, 422 INVALID_ANALYSIS, 크기 초과는 413 INVALID_REQUEST. 생성 실패는 data.error_code의 PROVIDER_ERROR/INVALID_ANALYSIS 등. LLM 안전 오류는 LLM-DRAFT.md에 정의돼 있으나 preview는 LLM을 실행하지 않는다.
- bridge: 409 ANALYSIS_VERSION_CONFLICT, 422 NEED_EVIDENCE_MISSING, Zod 입력 오류는 향후 업무 HTTP adapter에서 400으로 매핑 필요.
- 복지: 503 CATALOG_UNAVAILABLE/CATALOG_INVALID.

401은 로그인 안내, 403은 접근 제한, SOURCE_MISMATCH는 BE2 기록 재선택/재분석, 422는 근거 확인, 503은 자료 일시 불가로 표시한다. 통신 실패는 로컬 서버 시작/포트와 CORS를 확인하고 무한 재시도하지 않는다.

## BE1·BE2 연결 전후와 모바일 시연 잔여 작업

현재는 고정 Actor + 합성 권한 포트 + 코드 소유 RecordVersion fixture다. BE1 연결 후 `Authentication(Request)→Actor|null`, `AuthorizationPort.canAccess(actor,personId,read|write|analyze)→boolean`이 실제 세션·관계·배정·동의·철회를 확인해야 한다. preview 응답을 실제 권한 완료로 표시하지 않는다.

BE2는 OCR/STT `confirmedInput` 결과를 공식 상담에 저장하고 consultation_id/record_version_id를 반환해야 한다. RecordReader.getVersion(c,v)는 불변 원문/person_id를 반환해야 한다. 현재 BE3는 공식 기록 버전을 생성하지 않는다. 실제 과거/현재 시간 순서·최신 버전 정책, 인계 멱등성과 동시 수정도 합의해야 한다.

운영 연결 시 고정 correction/ID 대신 업무 요청을 사용하고, 필요 영역 확인은 실제 승인본 버전·근거 선택에 묶어 bridge HTTP adapter로 제공해야 한다. 실제 업로드·실제 모델 선택·영속 저장·감사/보관/삭제·재교정 정책은 별도다. 현재 preview 요청 스키마를 운영 업로드 API로 확장해 사용하면 안 된다.

모바일 앱까지 남은 항목은 FE의 개발용 base URL/fixture 모드 연결, 비밀값 없는 개발 빌드 네트워크 정책, USB/격리 시연 방식 승인, 실제 BE1/BE2 adapter 및 공식 API 조립, 담당자 동작 UI와 실패 UI 검증이다. FE 저장소는 이번 작업에서 수정하지 않았다.

## 검증 명령

2026-10-30 KST 검증: typecheck PASS, test 14개 파일 **377건 PASS(기존 357 + 신규 20)**, build PASS. 권장 opt-in 명령으로 실제 loopback 서버를 실행해 GET scenario 200 및 `http://localhost:5173` CORS 응답을 확인하고 종료했다. 14개 화면 JSON은 별도 합성 서비스 세션에서 캡처했다. 운영 앱/서버/공통 계약/타 팀 소스는 변경하지 않았다.

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

`tests/be3-preview.test.ts`는 opt-in/합성 전체 흐름/입력 거부/원문 비반사/미확정·미승인·미확인 차단/CORS·host·크기/운영 미마운트를 검증한다. 테스트의 "PRIVATE_SENTINEL"은 가상 문자열이며 개인정보가 아니다.
