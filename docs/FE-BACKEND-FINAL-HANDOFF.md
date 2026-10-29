# 2026-10-30 최종 통합 상태

최종 검증 코드 main: Backend `35348e12dcfbb47c4d8c082b3425171fd4757b65` (PR #30), Frontend `e2431f3858f16fb4ccc2b36adccb2343fc1543de` (PR #5). 문서 후속 PR은 Backend #31이다.

## 이번 최종 검증의 우선 적용 사항

- **기존 4324는 재시작·변경하지 않았다.** 이번 4계정과 역할 연결은 별도 4334 API에 생성했다. Flutter 웹은 Windows Node 프로세스의 `http://127.0.0.1:4335`이며 Docker 목록에 나타나지 않는다.
- 사용자 명시 허용 후 새 외부 웹 `https://grams-viewing-given-categories.trycloudflare.com/`를 생성했다. 4337 같은 출처 프록시→4334이며 실제 화면·4계정·OCR/STT/Qwen/Vision 연동을 검증했다. 기존 4324 터널과 다르다.
- **최신 간편 로그인 주소는 `https://wash-mighty-dust-director.trycloudflare.com/`**. staff1/김민준, staff2/이서연, user1/박영희, user2/최정호다. 사용자 요청의 공통 비밀번호는 Frontend `.runtime/demo-login-aliases.json`에만 보관한다. 4339 게이트웨이가 기존 계정으로 연결하며 4334 자격증명이나 메모리를 교체하지 않는다. 이 간편 ID는 최신 링크에서만 사용한다.
- 실제 로그인 가능한 합성 담당자 2명(staff), 예약자 2명(patient). staff는 배정된 대상자만, patient는 자기 자료만 읽고 자기 예약을 생성한다. patient는 기록 쓰기·OCR/STT/Vision·분석·승인·담당자 업무 생성이 403이다.
- 비밀번호/로그인 정보는 검증용 Backend 복제본 `.runtime/demo-credentials.json`에만 보관한다. 계정 생성 스크립트는 이 파일을 재사용하며 password는 Git에 없다.
- Flutter 실제 서버 모드에서 4계정 화면과 OCR/STT→교정→확정→기록→Qwen→근거→승인→합성 복지 후보를 검사했다. Android 실기기는 연결되지 않아 미검증이다.
- 상세 건수·실패·증거·최신 PR 상태는 [최종 검증 보고서](reports/CAREGAP_FINAL_INTEGRATION_VERIFICATION_2026-10-30.md)를 따른다. 아래 기존 4324 설명과 격리 서버 기능을 혼동하지 않는다.

### 선택적 Vision (main PR #28)

`POST /api/vision/analyses`, Bearer + `Idempotency-Key` 필수.
요청: `{person_id,filename,mimeType:"image/png" 또는 "image/jpeg",base64}`.
성공 201 `{data:{status:"succeeded",provider_metadata,provenance:{input_kind:"direct_multimodal_image",ocr_used:false,human_review_required:true},result:{care_note,observations,uncertainties,safety_notice}}}`.

원본 이미지가 Ollama messages.images에 직접 전달되며 OCR과 별개다. 실제 PNG/JPEG 추론은 4334에서 확인했다. Flutter PR #5는 기존 OCR을 유지하고 별도 Vision 버튼을 제공한다. 그림 설명 오류가 발견돼 사람이 검토하기 전 자동 기록 채택·승인하지 않는다. 기존 4324에는 이번 배포를 적용하지 않았다.

### 새 프로토타입/PR 추가분

#29 최신 `aad64a6b`는 이전 충돌을 해소했으며 격리 646개 테스트·타입·빌드가 통과했다. 실제 LiveKit은 CONFIG_MISSING으로 미검증이다. #26의 DB/FCM 영속화 변경도 포함하므로 실제 통화 완료로 표현하지 않는다. #24의 인증 우회·평문 secret·Prisma/기존 users migration 불일치는 병합 차단 사항이다. BE3 #5/#7/#14는 main에 이미 포함된 중복 PR이다.

- 완료·병합: FE 카메라 촬영 → 기존 OCR 요청/교정/확정/기록 import 흐름, WAV 전용 선택, 관련 Flutter CI. BE 구형 인증·관계·상담·복지 표면의 fail-closed 및 내부 오류 메시지 비노출.
- 보존: 기존 4324 통합 시연 서버의 실제 OCR/STT/Qwen/근거 검증/복지 후보 계약. 아래 API 표는 해당 통합 서버 기준이다.
- 주의: 일반 `src/app.ts`의 구형 `/api/auth`, `/api/relationships`, `/api/consultations`, `/api/welfare`는 검증된 운영 인증 어댑터가 없으므로 의도적으로 503이다. 프론트는 4324 통합 서버 외의 구형 엔트리포인트를 운영 API로 사용하지 않는다.
- 미완료·병합 금지: PR #26의 Supabase JWT/ID 매핑/FCM outbox/worker/통화 적격성은 코드 검토 단계다. PostgreSQL relation·migration 적용, 운영 worker, 실제 Firebase, 실기기 수신, 실제 통화가 검증되기 전에는 완료로 표시하거나 병합하지 않는다.
- 비밀 관리: 서비스 계정 JSON·개인키·서명키를 Git/문서/앱에 넣지 않는다. 회전된 키와 운영 비밀 저장소만 사용한다.
- 실기기 필수 확인: Android/iOS 카메라 권한·촬영 포맷, 실제 터널 OCR/STT/Qwen, FCM 수신, 양방향 통화/녹음. 현재 자동 테스트 통과와 실기기 통과를 구분한다.

## FE가 지금 연결할 최소 완성 흐름

1. `BACKEND_URL`을 현재 HTTPS 터널로 주입하고 `GET /health` 확인.
2. 합성 담당자 등록/로그인 → 합성 대상자 생성.
3. 카메라/파일 → OCR 또는 WAV → STT 작업 생성 → 성공 폴링 → 사람 교정 → 확정 → 기록 import.
4. 이전/현재 기록 선택 → Qwen 분석 → 근거 대조 → submit → approve/reject.
5. 승인본에서 담당자가 필요·근거를 선택 → 합성 복지 후보 표시.
6. 서버 재시작 시 메모리 데이터와 세션이 사라지므로 다시 합성 계정을 만든다.

---

# FE 최종 API 연결 계약

로컬: `http://127.0.0.1:4324`

임시 HTTPS: `https://favourite-bizrate-passed-calibration.trycloudflare.com`

합성 데이터 전용, 메모리 저장소입니다. 재시작하면 계정·토큰·기록·작업이 모두 초기화됩니다. Quick Tunnel 주소도 재시작 시 변경됩니다. 공개 자가등록은 운영 인증이 아니며 실제 개인정보를 입력하면 안 됩니다. 별도 PC의 FE 검증은 아직 필요합니다. Ollama는 공개하지 않습니다.

Vite 서버 프록시(브라우저에서 상대 경로 fetch 사용):
```ts
server: { proxy: {
 '/api': { target:'https://favourite-bizrate-passed-calibration.trycloudflare.com', changeOrigin:true,
   configure(proxy) { proxy.on('proxyReq', req => req.removeHeader('origin')); } },
 '/health': { target:'https://favourite-bizrate-passed-calibration.trycloudflare.com', changeOrigin:true,
   configure(proxy) { proxy.on('proxyReq', req => req.removeHeader('origin')); } }
} }
```
Bearer 헤더는 그대로 전달합니다. 직접 브라우저 교차 출처 호출은 FE_ORIGINS에 정확한 출처를 등록해야 하며 기본값은 거절합니다.

## 인증
`POST /api/auth/register` 및 `POST /api/auth/login`:
```json
{"identifier":"synthetic-fe-demo-unique","password":"synthetic-password-unique-2026"}
```
등록은 201 `{data:{user_id,role:"staff",synthetic_only:true}}`. 로그인은 200 `{data:{access_token,token_type:"Bearer",expires_in:3600,actor,...}}`입니다. 아래 요청은 모두 `Authorization: Bearer <access_token>`을 사용합니다. `GET /api/auth/me`, `POST /api/auth/logout`(204). 고정 계정은 없습니다.

## 화면별 경로
모든 예시 ID는 직전 응답 값을 사용합니다. 성공 응답은 `{data:...}`이며 분석도 이 계약을 사용합니다. 정확한 실행 요청·응답은 `final-http-example.json`에 기록합니다.

|기능|API|요청|
|---|---|---|
|대상자 생성/목록|POST/GET `/api/persons`|POST `{}` → `{person_id,synthetic_only:true}`|
|예약 생성|POST `/api/appointments`|`{person_id,starts_at:"2026-11-01T01:00:00Z",ends_at:"2026-11-01T02:00:00Z"}`|
|예약 조회|GET `/api/appointments`|내 예약 배열|
|예약 완료/취소|POST `/api/appointments/:id/actions`|`{action:"complete",expected_status:"scheduled"}` 또는 cancel|
|기록 생성|POST `/api/records`|`{person_id,text}` → `{person_id,consultation_id,record_version_id,text}`|
|기록 목록/버전 이력|GET `/api/records?person_id=...`|수정 전후 불변 버전 모두 반환|
|새 기록 버전|POST `/api/records/:consultation_id/versions`|`{expected_record_version_id,text}`|
|후속 업무 생성|POST `/api/follow-ups`|`{person_id,title,consultation_id?,record_version_id?}` 참조 두 필드는 함께 사용|
|후속 업무 목록|GET `/api/follow-ups?person_id=...`|내 대상자 업무 배열|
|업무 완료/취소|POST `/api/follow-ups/:id/actions`|`{action:"complete",expected_status:"open"}` 또는 cancel|
|내 알림 생성|POST `/api/notifications`|`{title,body}` 수신자는 로그인 사용자로 강제|
|내 알림 조회/읽음|GET `/api/notifications`, POST `/api/notifications/:id/read`|읽음 요청 `{}`|

알림은 인앱 수동 알림입니다. 자동 푸시·문자 발송은 구현하지 않았습니다. PostgreSQL 저장은 활성화하지 않았습니다.

## OCR/STT 순서
1. POST `/api/ocr/jobs` 또는 `/api/stt/jobs`: `{person_id,request_key,filename,mimeType,base64}`. PNG/JPEG 또는 16kHz mono PCM16 WAV. 202의 `data.id` 보관.
2. GET `/api/{ocr|stt}/jobs/:id`를 폴링. `status`가 succeeded인지 확인. `original`은 실제 모델 원문이며 교정문과 다릅니다. failed는 정상 성공으로 취급하지 않습니다.
3. POST `/api/ocr/jobs/:id/corrections`: `{expected_version:0,text}`. STT는 `{expected_version:0,segments:[{start_ms:0,end_ms:8175,speaker_id:"unknown",text}]}`.
4. POST `/api/{ocr|stt}/jobs/:id/confirmation`: `{expected_version:1}`.
5. POST `/api/records/import`: `{source:"stt",job_id}`. 반환된 consultation_id/record_version_id를 분석에 전달.

OCR은 실제 ONNX지만 손글씨 정확도 보장은 아닙니다. STT 자동 화자 분리는 없습니다. `provider_kind:injected` 및 health의 실제 제공자를 함께 확인합니다. corrections/confirmed는 사람의 작업입니다.

## 실제 Qwen 분석·승인·추천
POST `/api/analyses`, 새 분석마다 새로운 `Idempotency-Key`:
```json
{"person_id":"<person>","past":[{"consultation_id":"<past>","record_version_id":"<past-version>"}],"current":{"consultation_id":"<current>","record_version_id":"<current-version>"}}
```
응답 `data.status`를 반드시 확인합니다. HTTP 200이어도 failed일 수 있습니다. 정상은 `provider_kind:"llm"`, `provider_metadata:{provider:"ollama",model:"qwen2.5vl:7b",prompt_version:"caregap-temporal-v2"}`, `original.findings`의 change/evidence 및 questions입니다. GET `/api/analyses/:id`로 조회합니다.

POST `/api/analysis-reviews/:id`: `{action:"submit",expected_version:1}` 이후 `{action:"approve",expected_version:2}`. 담당자가 원문과 의미를 확인해야 하며 자동으로 승인하면 안 됩니다.

POST `/api/welfare-recommendations`:
```json
{"analysis_id":"<id>","expected_analysis_version":3,"confirmations":[{"need":"meal_support","finding_index":0,"evidence_index":0,"confirmed":true}]}
```
`data.candidates`를 표시합니다. 복지 목록은 합성·미확인 후보이며 자격 판정이 아닙니다. 정보 부족 분석은 현재 INVALID_ANALYSIS로 차단될 수 있습니다.

## 오류 및 합성 시연
401 인증 실패/만료/로그아웃, 403 다른 대상자 또는 Origin 거절, 404 없음, 409 버전 충돌·미확정 가져오기·미승인 추천, 400 잘못된 입력, 429 호출 제한. `{error:{code}}`를 표시하고 오류 상태에서 다음 단계로 진행하지 마세요.

검증 입력: 이전 “어제 식사는 두 번 했습니다. 약을 빠뜨렸습니다. 산책은 한 번 했습니다.” → 현재 음성 교정문 “오늘 식사는 세 번 했습니다. 약을 빠뜨리지 않았습니다. 산책은 두 번 했습니다.” 실제 STT 원문은 복약 표현을 오인식했으므로 반드시 교정 화면에서 구분합니다.
