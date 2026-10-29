# BE3 integration preview

이 문서는 PR #4~#9를 `origin/main` 위에 통합한 격리 브랜치의 합성 시연 및 FE 연결 안내다. 라우터는 운영 `src/app.ts`에 마운트하지 않았으며, 모든 저장소는 프로세스 메모리 기반이다.

## 2단계: 승인 분석 → 담당자 필요 영역 확인 → 복지 후보

검증 결과: `pnpm typecheck`, `pnpm test`(13개 파일/357건: 기존 339건 + 신규 18건), `pnpm build` 모두 PASS. 신규 파일을 포함한 Git 공백 검사도 PASS. 아래 CLI 실제 실행은 근거 검증 통과, 승인 버전 3, 명시적 필요 확인 3건, 합성 복지 후보 3건(`unverified`)을 반환했다. 2단계 변경 파일은 `analysis-welfare-bridge.ts`, `be3-analysis-welfare-demo.ts`, `analysis-welfare-bridge.test.ts`와 이 문서이며 통합 브랜치에만 로컬 커밋한다.

```powershell
pnpm exec tsx scripts/be3-analysis-welfare-demo.ts
```

`AnalysisWelfareBridge`가 기존 `AnalysisWorkflow.published()`와 `WelfareRecommendationService.recommend()`를 연결한다. 호출자는 승인 결과 객체나 대상자 ID를 전달하지 않고 분석 ID·버전과 담당자의 명시적 선택만 전달한다. 대상자는 승인본에서 가져온다. 승인·권한·원문 버전 검사는 기존 workflow를 재사용하며, 추천 서비스의 비동기 카탈로그 조회 이후에도 다시 확인한다.

필요 영역 선택은 `confirmed:true`와 승인본 finding/evidence의 0-based 인덱스가 필요하다. 지원 코드는 `meal_support`, `mobility_support`, `medication_management`다. 선택이 없거나 중복·미확인·근거 인덱스 누락이면 추천을 호출하지 않는다. 승인 전/반려/다른 담당자 소유/버전 불일치/원문 변경/권한 철회도 차단한다.

연결 계층은 문장 의미를 분류하거나 건강·소득·자격을 추론하지 않는다. 인용이 실제 원문에 존재하는지는 workflow가 검증하고, 인용이 선택한 필요 영역을 뒷받침하는지는 담당자가 직접 판단·확인한다. FE는 체크박스를 사전 선택하지 않고 원문 인용과 필요 영역을 함께 보여야 한다. 이 확인 결과는 반환 객체에 담당자·시각·분석 버전과 함께 남지만 영속 감사 저장소는 아직 없다.

지역·연령은 `null`, 소득은 `unknown`으로 고정한다. 확인하지 않은 인구학 정보 입력은 이 연결 계약에서 받지 않는다. 복지사업 자격은 기존 추천 서비스의 `unverified`를 유지한다.

서비스 메서드 입력 예시(HTTP 엔드포인트 추가 없음):
```json
{"analysis_id":"<승인 분석 UUID>","expected_analysis_version":3,"confirmations":[{"need":"meal_support","finding_index":0,"evidence_index":1,"confirmed":true}]}
```

반환 구조는 `{data,connection}`이다. `data`는 기존 복지 추천 응답 그대로이며, `connection`에는 승인본 참조, 담당자 확인 이력, 원문 인용, 실제 추천 입력이 들어간다. CLI에서만 별도 `demo` 필드가 추가된다. 실제 합성 실행의 FE 표시용 후보 예시(3건 중 식사 후보 한 건, 나머지 필드는 기존 복지 계약 유지):
```json
{
  "data": {
    "person_id": "00000000-0000-4000-8000-000000000002",
    "algorithm": "rules-v1",
    "candidates": [{
      "program_id": "demo-meal",
      "program_name": "[합성] 식사 지원 연결 테스트",
      "reason": "식사 지원 필요와 관련하여 확인해 볼 후보입니다. 자격·지원 제공은 미확인입니다.",
      "eligibility_status": "unverified",
      "matched_needs": ["meal_support"],
      "data_status": "synthetic_demo",
      "source_url": null,
      "checked_at": null,
      "missing_information": ["거주지역 확인 필요", "연령대 확인 필요", "소득·수급 관련 조건 확인 필요", "공식 출처 확인 필요"],
      "warning": "합성 시연 전용이며 실제 제도·혜택이 아닙니다."
    }],
    "unmatched_needs": [],
    "disclaimer": "확인해 볼 후보 정보이며 실제 수급 자격·지원 제공·금액을 판정하거나 보장하지 않습니다. 관할 기관 확인이 필요합니다."
  }
}
```

위 JSON은 FE 설명용 축약본이며 `missing_information`도 일부만 표시했다. 전체 실제 응답은 CLI가 출력한다. FE는 `connection.confirmations[].evidence`의 원문 근거와 `data.candidates[].basis`의 사업 조건 근거를 구분하고, 경고·미확인 조건·출처·안내를 함께 표시해야 한다.

실제 연결: 합성 기록 reader → Mock 분석 초안 → 정확 인용 검증 → workflow 승인본 조회 → 명시적 필요 확인 검증 → 기존 추천 서비스 → 후보 응답. CLI의 담당자 제출·승인·필요 확인은 고정된 합성 선택으로 시뮬레이션한다. 키·환경변수·외부 모델·API·DB는 사용하지 않는다.

BE1 연동: 실제 세션에서 얻은 Actor와 최신 대상자 권한 adapter 필요. 기존 workflow는 승인본을 만든 담당자 소유만 허용하며 다중 담당자 공유 정책은 변경하지 않았다. BE2 연동: 실제 불변 기록 reader와 공식 저장 연결 필요. OCR/STT→BE2 경계는 여전히 미연결이다. 운영 라우터·FE 소스·공통 계약 변경은 없다.

추가 오류: `ANALYSIS_VERSION_CONFLICT`(409), `NEED_EVIDENCE_MISSING`(422). 입력 스키마 오류는 Zod 오류이며 향후 HTTP adapter에서 400 envelope로 변환해야 한다. 기존 `NOT_APPROVED`, `SOURCE_MISMATCH`, `FORBIDDEN`, `NOT_FOUND`와 복지 오류는 그대로 전달된다.

아래 1단계 기록에서 "분석→복지 미연결" 및 "두 신규 파일"은 1단계 시점의 상태다. 2단계 CLI와 연결 계층이 담당자 확인을 거친 연결을 추가하며, 기존 1단계 CLI는 독립 구간 시연으로 유지한다.

## 실제 통합 및 검증 결과

- Source: `C:\Users\Owner\Documents\Codex\CareGap-Backend-Source` (main, clean)
- Integration: `C:\Users\Owner\Documents\Codex\CareGap-Backend-Integration`
- 브랜치: `integration/be3-preview`
- 기준 origin/main: `3f57faad334e04fa39bcfa4a0c901e5205b02242`
- GitHub 확인 당시 PR #4~#10 모두 open/미병합. #10과 MultiA/MultiB 작업은 통합 제외.

| PR | 원본 커밋 | 통합 커밋 |
| --- | --- | --- |
| #4 | 3dc0d8a4cabdca34b415d25004a5ba429c4c04ff | a67d6ff |
| #5 | be240f7862ef0d08b92bcdc4d8ea8ce1a93e8b13 | 05460ab |
| #5 | ca4ab27fbd19a3cd4c80b2851dbe8a6ea832b610 | 4c0ee30 |
| #6 | f62416d019ba99b7fc1cbf01cb15e9d1bf460e6e | 2e39e1f |
| #7 | 3f9fcedf6d3331ef662654167b0343abd434e91c | 656e452 |
| #8 | d93aea38410ffe4c2281a182a0c8c35f524c8175 | 18995ab |
| #9 | da657d878e65ce7fc8a5ed726df78ac9239aab2a | 653612a |

충돌 없이 적용됐다. frozen-lockfile 설치, typecheck, test(12개 파일/339건), build, diff check 모두 성공했다. 새 시연 스크립트 추가 후 typecheck/test/build도 재실행해 성공했다. 시연은 OCR/STT 확정 버전 1, 분석 근거 검증 통과·시연 승인, 합성 복지 후보 3건을 반환했다. 실제 OCR/STT 모델 정확도와 운영 DB/인증 연결은 검증 범위 밖이다.

추가 작성 파일은 이 문서와 `scripts/be3-integration-demo.ts` 두 개이며 검증 결과 보존용 로컬 커밋에 포함한다. 기존 업무 소스의 수동 수정은 없다. 기존 PR에서 가져온 변경 파일 전체는 `git diff --name-only origin/main...HEAD`로 재현할 수 있다. 설치/빌드는 Integration 안에 `node_modules`/`dist`를 생성했다. Source에는 clone/fetch/worktree Git 메타데이터가 생성됐고 작업 파일은 깨끗하다. 원격 push/PR 생성/병합은 수행하지 않았다. 이 통합 브랜치는 검증용으로 유지하며 기존 공식 PR을 대체하지 않는다.

실행 명령 기록(두 전용 폴더 기준):
```powershell
git clone https://github.com/KMU5881193/CareGap-Backend.git C:\Users\Owner\Documents\Codex\CareGap-Backend-Source
# Source에서:
git remote -v
git branch --show-current
git status --short --branch
git fetch origin main refs/pull/4/head:refs/remotes/origin/pr/4 refs/pull/5/head:refs/remotes/origin/pr/5 refs/pull/6/head:refs/remotes/origin/pr/6 refs/pull/7/head:refs/remotes/origin/pr/7 refs/pull/8/head:refs/remotes/origin/pr/8 refs/pull/9/head:refs/remotes/origin/pr/9
git worktree add -b integration/be3-preview C:\Users\Owner\Documents\Codex\CareGap-Backend-Integration origin/main
# Integration에서 위 표 순서대로 각 원본 SHA에 대해:
git cherry-pick <SHA>
git log --oneline --decorate origin/main..HEAD
git diff --name-only origin/main...HEAD
git status --short --branch
```

각 PR의 추가 커밋 확인에는 `git log --reverse --format='%H %s' origin/main..origin/pr/<번호>`를 사용했다. 그 밖에 `Get-Content`, `rg`, `Get-ChildItem`으로 저장소 코드·테스트·문서·tsconfig와 AGENTS 지침 유무를 확인했고, 아래 검증/시연 명령을 실행했다. 신규 파일은 apply_patch로 작성했다. 신규 미추적 파일의 공백 검사에는 `git diff --no-index --check -- NUL <신규 파일>`도 실행했다. LF→CRLF 안내만 있었고 공백 오류는 없었다.

## 로컬 검증 및 시연

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
git diff --check origin/main...HEAD
pnpm exec tsx scripts/be3-integration-demo.ts
```

마지막 명령은 키나 환경변수를 읽지 않고 외부 API를 호출하지 않는다. OCR/STT Mock, 코드 소유 합성 BE2 기록 fixture, Mock 분석, 합성 복지 카탈로그만 사용한다.

## 연결 상태

1. OCR 작업 → 담당자 교정 → 확정 → BE2 인계 객체: 연결됨.
2. STT 작업 → 담당자 교정 → 확정 → BE2 인계 객체: 연결됨.
3. BE2 불변 기록 버전 조회 → 분석 입력 검증 → 비교 초안 → 인용 근거 검증 → 제출·승인: 합성 `RecordVersion` fixture 안에서 연결됨.
4. 복지 후보 추천: 합성 구조화 입력으로 별도 호출됨.
5. OCR/STT 확정본 → BE2 `consultation_id`/`record_version_id`: 미연결.
6. 승인 분석 → 복지 `needs` 변환: 미연결. 현재 자동 변환 계약이 없으므로 시연이 입력을 위조하지 않는다.

## FE API 계약

공통 성공 envelope는 `{ "data": ... }`, 실패 envelope는 `{ "error": { "code": "...", "message": "..." } }`다. 아래 OCR/STT prefix는 라우터 자체 경로가 `/jobs`이므로 서버 마운트 시 팀이 확정해야 한다. 제안 prefix는 각각 `/api/ocr`, `/api/transcripts`다.

### OCR (제안 prefix `/api/ocr`)

| Method | Path | 요청 핵심 | 성공 |
| --- | --- | --- | --- |
| POST | `/api/ocr/jobs` | `person_id, request_key, filename, mimeType, base64` | 202, 작업 상태 |
| GET | `/api/ocr/jobs/:id` | - | 상태, `provider_kind`, 버전 |
| GET | `/api/ocr/jobs/:id/result` | - | 원문·교정 이력 |
| POST | `/api/ocr/jobs/:id/corrections` | `expected_version, text` | 새 교정 버전 |
| POST | `/api/ocr/jobs/:id/confirmation` | `expected_version` | `confirmed` 상태 |

`provider_kind`는 `mock` 또는 `injected`다. 주요 오류는 `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_REQUEST`, `INVALID_IMAGE`, `EMPTY_IMAGE`, `IMAGE_TOO_LARGE`, `CORRUPT_IMAGE`, `CONFLICT`, `NOT_FOUND`, `RESULT_NOT_READY`, `NOT_CONFIRMED`다.

### STT (제안 prefix `/api/transcripts`)

| Method | Path | 요청 핵심 | 성공 |
| --- | --- | --- | --- |
| POST | `/api/transcripts/jobs` | `person_id, request_key, filename, mimeType, base64` | 202, 작업 상태 |
| GET | `/api/transcripts/jobs/:id` | - | 상태, `provider_kind`, 구간 |
| GET | `/api/transcripts/jobs/:id/result` | - | 원문·구간·교정 이력 |
| POST | `/api/transcripts/jobs/:id/corrections` | `expected_version, segments[]` | 새 교정 버전 |
| POST | `/api/transcripts/jobs/:id/confirmation` | `expected_version` | `confirmed` 상태 |

현재 통합 PR의 STT 결과는 `diarization: "none"`이며 음향 기반 화자 분리는 MultiA 범위다. 주요 오류는 `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_REQUEST`, `INVALID_AUDIO`, `AUDIO_TOO_LARGE`, `AUDIO_TOO_LONG`, `CORRUPT_WAV`, `INVALID_SEGMENTS`, `CONFLICT`, `NOT_FOUND`, `RESULT_NOT_READY`, `NOT_CONFIRMED`, `STT_TIMEOUT`, `STT_PROVIDER_FAILED`다.

### 상담 분석

| Method | Path | 요청 핵심 | 성공 |
| --- | --- | --- | --- |
| POST | `/api/analyses` | 헤더 `Idempotency-Key`; `person_id, past[{consultation_id,record_version_id}], current{...}` | 분석 작업 |
| GET | `/api/analyses/:id` | - | 원본·편집본·검토 상태 |
| POST | `/api/analysis-reviews/:id` | `expected_version, action: edit|submit|approve|reject`, edit 시 `draft` | 갱신된 작업 |
| GET | `/api/analyses/:id/published` | - | 승인된 편집본만 |

`provider_kind`는 `mock` 또는 `llm`이고, `llm`은 별도 `provider_metadata`가 있다. 이번 통합 시연은 `mock`만 사용한다. 주요 오류는 `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_REQUEST`, `SOURCE_MISMATCH`, `INVALID_ANALYSIS`, `EVIDENCE_CHANGED`, `CONFLICT`, `NOT_FOUND`, `NOT_APPROVED` 및 LLM 전용 안전 오류 코드다.

### 복지 후보

| Method | Path | 요청 핵심 | 성공 |
| --- | --- | --- | --- |
| GET | `/api/welfare-programs` | 선택 query: `q, need, region, age_group, data_status, limit, offset` | 카탈로그 목록 |
| GET | `/api/welfare-programs/:id` | - | 단일 사업 |
| POST | `/api/welfare-recommendations` | `person_id, needs[], region, age_group, income_status` | 후보·근거·미확인 조건 |

FE는 `data_status`, `warning`, `missing_information`, `disclaimer`를 표시해야 한다. `eligibility_status: "unverified"`를 자격 확정이나 승인으로 표현하면 안 된다. 주요 오류는 `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_REQUEST`, `NOT_FOUND`, `CATALOG_UNAVAILABLE`, `CATALOG_INVALID`다.

## FE 화면 연결 순서

### 요청·응답 JSON 예시

아래는 핵심 필드만 표시한 축약 예시다. `base64`에는 실제 파일 인코딩을 넣어야 하며 예시 문자열 자체는 유효한 파일이 아니다. ID는 합성 값이며 BE2 공식 버전을 생성하는 명령이 아니다.

OCR 생성 요청:
```json
{"person_id":"00000000-0000-4000-8000-000000000002","request_key":"demo-ocr","filename":"synthetic.png","mimeType":"image/png","base64":"<PNG base64>"}
```

생성 응답의 주요 필드와 교정·확정 요청:
```json
{"data":{"id":"<job UUID>","status":"pending","provider_kind":"mock","version":0,"corrections":[]}}
```
```json
{"expected_version":0,"text":"합성 상담 교정 문장"}
```
```json
{"expected_version":1}
```

확정 응답에는 `confirmed:{version:1,confirmed_by:"<actor UUID>",confirmed_at:"<ISO datetime>"}`가 추가된다. OCR/STT는 원문 생성만으로 확정되지 않으며, 첫 교정 버전을 만든 뒤 확정해야 한다.

STT 생성은 같은 업로드 구조에서 `filename:"synthetic.wav"`, `mimeType:"audio/wav"`, WAV base64를 사용한다. 생성 응답은 `revisions:[]`, `version:0`, `provider_kind:"mock"`를 포함한다. 교정 요청 예시:
```json
{"expected_version":0,"segments":[{"start_ms":0,"end_ms":1000,"speaker_id":"unknown","text":"합성 전사 교정 문장"}]}
```

분석 생성 요청(헤더 `Idempotency-Key: demo-analysis`):
```json
{"person_id":"00000000-0000-4000-8000-000000000002","past":[{"consultation_id":"00000000-0000-4000-8000-000000000003","record_version_id":"00000000-0000-4000-8000-000000000004"}],"current":{"consultation_id":"00000000-0000-4000-8000-000000000005","record_version_id":"00000000-0000-4000-8000-000000000006"}}
```

성공 시 작업은 `status:"succeeded",review_state:"draft",version:1,original,edited,sources,history`를 포함한다. 생성이 HTTP 200이어도 `data.status:"failed"`와 `data.error_code`를 확인해야 한다. 편집 없이 제출·승인하는 요청은 차례로 다음과 같다:
```json
{"expected_version":1,"action":"submit"}
```
```json
{"expected_version":2,"action":"approve"}
```

승인본 응답의 핵심 형태:
```json
{"data":{"id":"<analysis UUID>","input":{"person_id":"<person UUID>","past":[],"current":{"consultation_id":"<UUID>","record_version_id":"<UUID>"}},"provider_kind":"mock","review_state":"approved","draft":{"status":"draft","findings":[{"text":"합성 변화 설명","change":"worsened","evidence":[{"consultation_id":"<UUID>","record_version_id":"<UUID>","quote":"원문과 정확히 일치하는 인용"}]}],"questions":["다음 상담 확인 질문"]},"version":3}}
```

이는 구조 설명용 축약 응답이며 실제 `past`에는 입력한 참조가 유지된다. 내부 `draft.status`는 승인 후에도 `draft`이고, FE 승인 표시는 `review_state`를 기준으로 한다.

복지 요청:
```json
{"person_id":"00000000-0000-4000-8000-000000000002","needs":["meal_support","mobility_support","medication_management"],"region":null,"age_group":null,"income_status":"unknown"}
```

응답은 `{data:{person_id,algorithm:"rules-v1",candidates:[],unmatched_needs:[],disclaimer}}` 구조다. 후보별 전체 실제 합성 실행 예시는 `examples/welfare/recommendations.synthetic.json`, 요청은 `examples/welfare/request.synthetic.json`에 있다. LLM 어댑터의 가짜 HTTP 응답 예시는 `examples/analysis/llm-mock-http.json`이며 실제 LLM 출력으로 표시하면 안 된다.

오류 응답 예시:
```json
{"error":{"code":"CONFLICT","message":"CONFLICT"}}
```

HTTP 401은 세션 확인, 403은 접근 제한, 409는 최신 버전/확정/승인 상태 재조회, 400은 입력 수정, 413은 업로드 축소로 처리한다.

1. BE1 세션/대상자 접근 권한 확인.
2. OCR 또는 STT 작업 생성 후 상태 polling.
3. 원문과 교정 이력을 표시하고 담당자가 교정·확정.
4. BE2가 확정본을 공식 상담 및 불변 기록 버전으로 저장한 뒤 그 ID를 반환.
5. 해당 ID들로 분석 생성, 원문 인용을 함께 표시.
6. 담당자 `edit → submit → approve`; 승인 전 공개 화면 차단.
7. 별도 구조화 필요정보 입력/확인 화면을 거쳐 복지 후보 API 호출.
8. 후보를 자격 확정이 아닌 탐색 결과로 표시.

## BE1·BE2 필수 연결

- BE1: 모든 라우터에 실제 세션 해석기 주입, 대상자 관계·배정·동의·철회와 `read/write/analyze` 권한 구현, 존재 여부 은닉 정책 합의.
- BE2: OCR/STT 확정본을 상담에 귀속하고 불변 `consultation_id`/`record_version_id`를 생성·조회하는 adapter, 변경/삭제 시 분석의 `SOURCE_MISMATCH` 정책 합의.
- 공통: OCR/STT mount prefix 확정, 영속 저장소·원자적 버전 갱신·보관/삭제/감사 정책, OpenAPI 계약, 운영 요청 크기와 rate limit.
- 분석→복지: 승인 분석에서 제한된 `needs` enum으로 이동하는 담당자 확인형 변환 계약. 자동 자격 판정은 금지.
