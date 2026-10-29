# BE3 합성 상담 LLM 연결 초안

PR #6의 AnalysisWorkflow/AnalysisProvider/validateDraft/Review/API를 재사용한다. 공통 계약, BE1/BE2/FE, DB, 운영 앱·서버 진입점 및 OCR/STT는 변경하지 않는다. 신규 SDK/패키지를 추가하지 않고 Node 22 native fetch를 사용한다.

## 구현 및 실제 실행 여부

OpenAI Responses REST API `POST https://api.openai.com/v1/responses`와 `text.format: {type:json_schema,strict:true}`를 사용한다. 스키마는 기존 AnalysisDraft에서 생성하고 로컬에서는 기존 validateDraft를 다시 적용한다. 응답 refusal/incomplete/다른 모델/잘못된 JSON·스키마·근거를 거부한다. llm 제공자에는 최소 1개 finding, 질문 2~3개, unknown 외 비교에는 과거·현재 양쪽 evidence를 추가로 요구한다. 기존 공통 AnalysisDraft 계약은 변경하지 않는다.

공식 참고:

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [GPT-4o mini 모델 및 snapshot](https://developers.openai.com/api/docs/models/gpt-4o-mini)

확인한 로컬 환경은 Node v22.15.0/native fetch 사용 가능, OPENAI_API_KEY/모델/승인 설정 없음이다. 실제 API 호출·과금·모델 계정 접근 확인은 수행하지 않았다. 테스트는 HTTP 응답을 메모리에서 주입하며 외부 네트워크를 사용하지 않는다. Supertest는 localhost만 사용한다. 실제 출력 품질·의학적 타당성·prompt injection 저항성이 검증되었다고 주장하지 않는다.

## 개인정보와 승인 경계

이 어댑터는 **코드에 고정된 합성 상담 2건의 텍스트·상담 ID·버전 ID·순서가 모두 정확히 일치할 때만** HTTP를 허용한다. caller가 synthetic=true를 선언하거나 임의 파일/문장을 넣는 방식은 없다. 임의 텍스트/다른 ID/추가 필드/명령문 삽입은 네트워크 전에 LLM_SYNTHETIC_ONLY로 거부한다. 따라서 이 PR은 일반 실제 상담 원문 전송 기능이 아니다. 더 많은 합성 사례를 추가하려면 코드 리뷰로 allowlist를 확장해야 한다. 이는 개인정보 탐지/익명화기가 아니다.

BE1 권한 검사는 기존 Workflow에서 원문 조회 전·제공자 호출 직전·생성 후 적용한다. BE2의 person_id 혼입 및 버전 불일치도 Workflow에서 차단한다. 어댑터는 승인된 {consultation_id,record_version_id,text}만 받으며 person/account ID를 받지 않는다. 어댑터 직접 호출에는 BE1 권한 의미가 없으므로 업무 코드는 반드시 Workflow를 통해야 한다.

비용 승인은 이 작업에 주어지지 않았으므로 실제 호출하지 않았다. 아래 실행은 **별도 사용자 승인 이후에만** 사용한다. 환경 opt-in은 실행 방지 장치이며 조직 승인/비용 한도 정책을 대체하지 않는다. 승인자가 허용한 계정·모델·횟수를 운영자가 확인해야 한다.

## 실행

의존성 설치 후 오프라인 시연:

```powershell
pnpm install --frozen-lockfile
pnpm exec tsx src/modules/be3-intelligence/analysis-llm-demo.ts mock
```

기존 `analysis-demo.ts` 시연도 그대로 작동한다. 새 데모는 합성 생성 → 근거 검증 → 담당자 질문 수정 → 검토 제출 → 승인 → 승인본 JSON 및 수정 이력을 출력한다. 자동화된 담당자 행위는 **합성 CLI 시연에만** 존재한다. 실제 서비스/API는 AI 결과를 자동 승인하지 않는다.

실제 LLM 설정은 `examples/analysis/llm.env.example` 참조. dotenv 자동 로드 및 키 파일 검색을 하지 않는다. 모델은 기본값 없이 명시적인 날짜 snapshot ID를 요구한다. 아래 모델은 공식 문서의 예시이며 해당 계정의 사용 가능 여부는 미확인이다. 비밀키를 명령행 리터럴/레포/로그에 남기지 않는다. 승인 후 PowerShell 세션에 안전하게 입력하는 예:

```powershell
# 별도 비용·외부 합성 데이터 전송 승인을 받은 뒤에만 실행
$secureKey = Read-Host 'OpenAI API key' -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
$env:CAREGAP_LLM_MODEL = 'gpt-4o-mini-2024-07-18'
$env:CAREGAP_LLM_APPROVED = 'synthetic-only-cost-approved'
try {
  pnpm exec tsx src/modules/be3-intelligence/analysis-llm-demo.ts llm
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:CAREGAP_LLM_APPROVED -ErrorAction SilentlyContinue
  $secureKey = $null
}
```

합성 텍스트 이외의 CLI 입력은 지원하지 않는다. API 키 없음은 LLM_API_KEY_MISSING, 승인 opt-in 없음은 LLM_APPROVAL_REQUIRED, 모델/숫자 설정 오류는 LLM_CONFIG_INVALID다. 실패 시 Mock으로 자동 전환하지 않는다. CLI는 실패 exit 1, 성공 exit 0이다. Ctrl+C는 AbortSignal로 전파한다. 취소/타임아웃은 서버 측 모델 실행·과금 취소를 보장하지 않는다.

| 환경변수 | 기본값 / 범위 |
| --- | --- |
| OPENAI_API_KEY | 필수 비밀, 최대 512자, 개행 거부 |
| CAREGAP_LLM_MODEL | 필수 날짜 snapshot, 최대 100자 |
| CAREGAP_LLM_APPROVED | `synthetic-only-cost-approved` 정확히 일치해야 실행 |
| CAREGAP_LLM_TIMEOUT_MS | 15000 / 1~60000 |
| CAREGAP_LLM_MAX_INPUT_BYTES | 16384 / 1~32768, 프롬프트·스키마 포함 전체 UTF-8 요청 |
| CAREGAP_LLM_MAX_OUTPUT_BYTES | 65536 / 1~131072, 전체 응답 stream 바이트 |
| CAREGAP_LLM_MAX_OUTPUT_TOKENS | 2048 / 128~4096 |

모든 호출은 요청 1회, 자동 재시도 0회다. 모델/계정에 따라 token 한도가 불충분할 수 있으며 incomplete로 실패 처리한다. endpoint 고정·redirect:error·tools:[]·store:false·stream:false를 사용한다. store:false는 외부 사업자의 모든 보관 정책에 대한 보증이 아니다. 키/설정/원문/외부 오류 본문을 어댑터에서 로그하지 않는다. CLI가 표시하는 모델 초안과 인용은 허용된 합성 시연 결과다.

## 결과와 FE 연결

기존 /api/analyses, /api/analysis-reviews, /api/analyses/:id/published 계약을 유지한다. Workflow 생성 시 `provider_kind:'llm', provider_metadata:provider.metadata`를 주입하면 생성·승인본에 다음 필드가 추가된다:

```json
{"provider_kind":"llm","provider_metadata":{"provider":"openai","model":"gpt-4o-mini-2024-07-18","prompt_version":"caregap-analysis-v1"}}
```

성공 시 응답 model이 요청한 snapshot과 동일함을 검사한다. 실패 작업의 metadata는 요청 모델을 뜻한다. metadata에는 키/endpoint/원문/HTTP 오류를 넣지 않는다. 원본은 기존 validated AnalysisDraft로 보존하고 API envelope/내부 reasoning 원문을 보관하지 않는다.

`examples/analysis/llm-mock-http.json`은 **실제 모델 출력이 아닌 Mock HTTP로 생성한** FE 예시다. 최상위 example_origin을 확인한다. data는 기존 승인본 응답 형태이며 별도 무근거 summary는 없다. 내부 draft.status는 draft를 유지하고 review_state가 승인을 나타낸다. 실제 LLM 문장/라벨은 예시와 다를 수 있다. CLI만 반환하는 demo 필드는 FE 업무 API 계약이 아니다.

실패는 기존 작업 응답 `{data:{status:'failed',error_code,...}}`, 승인·공개는 차단한다. 공개 가능한 오류 코드: LLM_SYNTHETIC_ONLY, LLM_INPUT_TOO_LARGE, LLM_OUTPUT_TOO_LARGE, LLM_HTTP_ERROR, LLM_NETWORK_ERROR, LLM_TIMEOUT, LLM_CANCELLED, LLM_INVALID_RESPONSE, LLM_REFUSED, LLM_INCOMPLETE, LLM_MODEL_MISMATCH, INVALID_ANALYSIS. HTTP client가 처리 중 연결을 종료하면 route가 AbortSignal을 전파한다. 생성 중 성공/실패가 확정되기 전에 취소한 경우 failed이며 늦은 제공자 완료로 succeeded를 덮어쓰지 않는다.

## 의미 검증과 연동 한계

원문은 JSON user data로 구분하고 system instructions가 기록 내 명령·링크 실행을 금지한다. 숫자·날짜·횟수·부정 표현, unknown과 unchanged 구분, 의료 단정 금지를 명시한다. 이는 프롬프트 통제이며 의미적 정확성을 증명하지 않는다. 정확한 양쪽 인용이 있어도 3→2회를 2→3회로 잘못 해석하는 문장은 출처 검증을 통과할 수 있음을 테스트로 명시했다. 실제 의미 판정은 담당자가 검토하고 반려해야 한다.

검토 상태·수정/승인 이력·근거 변경 차단·원문 snapshot 재확인·CAS는 PR #6을 재사용한다. Workflow는 선택적 AbortSignal과 제공자 metadata만 확장했고 기존 single-argument AnalysisProvider도 호환된다. 공유 인터페이스/AnalysisDraft는 변경하지 않았다.

BE1: 실제 인증/현재 동의·철회·배정·관계 확인 필요. BE2: 정확한 불변 원문/person_id/기록 순서와 최신 버전 변경 정책 필요. 운영 앱에는 마운트하지 않는다. 실제 상담 PII 처리는 금지이며 본 어댑터도 거부한다. 실제 운영 사용 승인, 개인정보 정책, 영속 저장소·분산 CAS·키 TTL·감사·동시성/비용 한도·제공자별 재시도 정책·모델 의미 정확도 평가는 이번 범위에서 미구현·미검증이다.

## 종속 PR

PR #6이 open인 상태에서 feature/ai-analysis-workflow를 기준으로 feature/ai-llm-provider를 만들었다. 신규 PR의 base도 feature/ai-analysis-workflow다. PR #6 병합 후 origin/main을 fetch하여 기반 커밋이 포함됐는지 확인하고 PR base를 main으로 변경한다. squash 병합 등으로 기반 커밋이 달라졌다면 중복 diff를 확인한 뒤 force push 없이 별도 정리 브랜치를 준비한다. 자동 병합하지 않는다.

## 검증

`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `git diff --check`를 실행한다. Mock CLI 정상 종료 및 키 없는 LLM CLI 실패(exit 1), 가짜 HTTP LLM 데모의 수정/검토/승인, 로컬 HTTP 연결 종료 취소를 검증한다. 실제 LLM 실행 검증과 구분한다.
