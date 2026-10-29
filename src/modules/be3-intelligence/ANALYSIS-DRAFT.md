# BE3 상담 분석·검토 API 초안

팀 공통 계약 확정 전의 독립 구현이다. `docs/contracts.md`, shared contracts, OpenAPI, BE1/BE2, DB, 운영 서버 진입점은 변경하지 않는다. OCR PR #4 없이 main의 AI 기반만 사용한다.

## 실행과 범위

Node 22.12+ 및 저장소 지정 pnpm 사용:

```powershell
pnpm install --frozen-lockfile
pnpm exec tsx src/modules/be3-intelligence/analysis-demo.ts
pnpm test
```

데모는 합성 기록으로 생성 → 검토 제출 → 승인 → 승인본 조회를 실행하고 JSON을 출력한다. HTTP 서버를 열거나 외부 모델을 호출하지 않는다. HTTP 경로는 Supertest 테스트로 시연할 수 있다: `pnpm exec vitest run tests/analysis-workflow.test.ts`.

`SyntheticAnalysisProvider`는 고정 합성 문장을 인식하는 결정적 Mock이다. 실제 자연어 모델/의료 판단/일반 한국어 파서가 아니다. 예시의 식사 3→2회, 외출 주 1회→못함, 매일 복용→2일 미복용을 각각 원문 두 개와 연결하고 질문 3개를 반환한다. worsened는 이 합성 시나리오의 활동·복용 기록 변화 라벨이며 건강 악화, 진단, 위험 등급을 의미하지 않는다. 미지원 기록은 unknown이다. improved/worsened/unchanged/unknown 네 값은 기존 AnalysisDraft로 보존한다.

인용 검증은 지정 원문에 해당 문자열이 존재한다는 출처 검증이다. 문장의 의미, 요약의 정확성 또는 의학적 타당성을 보증하지 않는다. 사실 주장도 findings에 넣어 evidence 없이 별도 요약 문자열을 공개하지 않는다. 실제 LLM adapter는 미구현이며 키, 유료 호출, 외부 개인정보 전송은 실행하지 않았다. AnalysisProvider 포트에 별도 구현을 주입할 수 있으나 `provider_kind: 'llm'` 표시만으로 실제 연결이 준비되는 것은 아니다.

## 인증·소유권·버전

`createAnalysisRouter(workflow, authenticate)`는 BE1 세션 인증 함수 주입이 필수이며 테스트 헤더 인증을 제공하지 않는다. 운영 `src/app.ts`에 마운트하지 않는다. 분석·초안 조회·검토는 생성한 staff 계정만 허용하는 보수적 정책이다. 다른 담당자 인계/다중 검토/가족 공개 정책은 미합의다. `/published`도 생성 계정 및 현재 read 권한이 필요하다. approved가 자동 가족 공개나 공개 인터넷 게시를 의미하지 않는다.

BE1 AuthorizationPort는 매 접근의 현재 관계·배정·AI 동의·철회를 검사해야 한다. 예외 및 boolean true 외 응답은 거부한다. 생성 전 read 자료를 확보하기 전에 analyze 권한을 검사하고 자료 확보 후/제공자 직전/생성 후 재검사한다. 종료 시 read 권한도 필요하다. 검토에는 write, 조회에는 read를 사용한다. 권한 철회 후 결과·원문 조회를 거부한다. 이미 실행 중인 제공자 취소는 미구현이다.

BE2 RecordReader는 요청한 consultation_id + record_version_id의 실제 불변 원문과 person_id를 반환해야 한다. 과거 1~20건과 현재 1건, 서로 다른 consultation_id 및 동일 person_id를 강제한다. 배열은 요청자가 제공하는 과거 순서이며 현재는 마지막이다. 시간 메타데이터가 포트에 없어 실제 과거/현재 날짜 순서는 검증하지 못한다. BE2가 순서와 최신 버전 정책을 보장해야 한다. 서비스는 지정 불변 버전/원문이 달라지거나 사라지면 생성 완료·검토·승인본 공개를 차단한다. 새 최신 기록 버전이 별도로 생겼는지는 현재 RecordReader 포트만으로 탐지하지 못한다.

## 요청·응답 예시

라우터를 테스트 앱에 단독 마운트한 기준이다. 성공은 `{data}`, 실패는 `{error:{code,message}}`. 오류 메시지에 원문이나 제공자 예외를 넣지 않는다.

`POST /api/analyses`, `Idempotency-Key: demo-1`:

```json
{
  "person_id": "00000000-0000-4000-8000-000000000002",
  "past": [{"consultation_id":"00000000-0000-4000-8000-000000000003","record_version_id":"00000000-0000-4000-8000-000000000004"}],
  "current": {"consultation_id":"00000000-0000-4000-8000-000000000005","record_version_id":"00000000-0000-4000-8000-000000000006"}
}
```

200 응답의 data: `id`, `status: running|succeeded|failed`, `provider_kind: mock|llm`, `input`(정확한 입력 목록), `sources`(권한 있는 담당자 전용 원문 snapshot), `original`(AI 원본), `edited`(수정본), `review_state`, `version`, `history`. failed이면 `error_code`를 반환하며 succeeded로 표시하지 않는다. 생성은 현재 동기 처리이며 중복 진행 중 요청에는 running 상태가 반환될 수 있다. queued/백그라운드 작업 인프라는 미구현이다.

`GET /api/analyses/:id`는 담당자 작업용 조회다. `POST /api/analysis-reviews/:id`:

```json
{"action":"submit","expected_version":1}
```

이후 `{"action":"approve","expected_version":2}` 또는 `{"action":"reject","expected_version":2}`. 수정은 draft 상태에서 아래처럼 조회한 edited를 복제하여 보낸다. 원래 finding 개수와 evidence 목록을 그대로 유지해야 한다. 원본의 evidence를 바꾸거나 finding을 추가/삭제하려면 새 분석이 필요하다. 모든 편집본은 validateDraft 검증을 통과해야 한다.

```javascript
const draft = structuredClone(data.edited); // GET /api/analyses/:id 의 data
draft.questions[0] = '식사 횟수가 줄어든 이유와 필요한 지원은 무엇인가요?';
const body = { action: 'edit', expected_version: data.version, draft };
// POST /api/analysis-reviews/:id, JSON.stringify(body)
```

상태는 draft → review → approved/rejected, 편집은 draft에서만 가능하다. 각 성공 명령이 version을 1 증가시킨다. 과거 version 요청 및 동시 승인 중 두 번째는 409 CONFLICT. approved/rejected는 이 초안에서 종료 상태다. 원본 및 편집별 actor_id·시각·snapshot을 별도 보존하고 응답은 deep copy다. 저장소 내부 원본을 덮어쓰지 않는다.

`GET /api/analyses/:id/published`는 approved 전 409 NOT_APPROVED. 승인 후 data는 `{id,input,provider_kind,review_state:"approved",draft,version}`이며 원문 전체와 검토 이력을 제외한다. 내부 draft.status는 기존 스키마의 `draft`를 유지하고 외부 review_state로 승인을 표현한다.

400 INVALID_REQUEST, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT/SOURCE_MISMATCH/EVIDENCE_CHANGED/NOT_APPROVED, 413 INVALID_REQUEST, 500 INTERNAL_ERROR. 생성의 provider 오류/근거·스키마 오류는 HTTP 200 작업 결과의 `status:failed`, `error_code:PROVIDER_ERROR|INVALID_ANALYSIS`로 표현한다. 검토 편집의 근거 오류는 422 INVALID_ANALYSIS다.

## 중복·저장·미구현

Idempotency-Key는 actor+analysis+key 범위, 필수 1~128자다. 같은 키·다른 유효 입력은 409. 동일 키·동일 입력은 진행/완료/실패 작업을 재조회한다. 실패 재시도는 새 키가 필요하다. 완료된 동일 actor·동일 입력은 새 키여도 기존 분석을 재사용한다(검토 상태와 무관). 입력 fingerprint에는 배열 순서가 포함된다. 서로 다른 키의 동시 미완료 동일 입력은 합치지 않는다. 제공자 변경/재분석/반려 후 재생성 정책은 후속 협의 사항이다.

인메모리 저장소는 프로세스·인스턴스별이며 재시작 시 사라진다. 다중 서버 CAS, 운영 영속화, 보존/삭제/감사 정책, 키 TTL, 전역 동시성 제한, 제공자 타임아웃/취소/재시도/큐, 승인자 분리 및 LLM 의미 검증은 미구현이다. BE1/BE2 실제 연동·DB·실제 모델 정확도·외부 개인정보 전송은 미검증이다. 실제 운영 마운트 전 해당 정책과 포트를 합의해야 한다.
