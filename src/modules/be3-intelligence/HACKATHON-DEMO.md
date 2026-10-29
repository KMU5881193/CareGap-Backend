# 해커톤 핵심 시연

새 기능 실험 없이 PR #6/#7/#9 코드를 한 로컬 명령으로 재현한다. 별도 `CareGap-Backend-Demo`, `feature/ai-demo-stabilization`에서 기존 브랜치를 결합했다. 원래 작업 폴더/브랜치, C 통합 폴더, main, BE1/BE2/FE, 운영 앱과 공통 계약은 변경하지 않는다. 기존 분석·LLM·복지 엔진 수정은 없다. 확인한 로컬 작업은 clean이고 장기 추세 작업 브랜치/파일은 발견하지 못했다. 기존 커밋을 보존하고 해당 기능 확대는 하지 않는다.

## 정상 실행

Node 22.12+와 저장소 지정 pnpm을 사용한다.

```powershell
pnpm install --frozen-lockfile
pnpm exec tsx src/modules/be3-intelligence/hackathon-demo.ts
```

tsx의 Windows sandbox 사용자 정보 조회 오류(`uv_os_get_passwd`)가 발생하면 정상 사용자 권한에서 실행하거나 아래의 빌드 산출물 명령을 사용한다. 이 경우 앱 로직이 시작되기 전 런타임 오류이므로 분석 실패와 구분한다.

```powershell
pnpm build
node dist/modules/be3-intelligence/hackathon-demo.js
```

기본 모드는 `official_snapshot`이다. 합성 상담 2건과 Mock 분석을 사용하고, PR #9에 저장된 공식 안내 snapshot의 후보 1건을 반환한다. 별도 정보 수집 없이 저장 자료만 사용하며 `checked_at`은 원래 확인 시각을 유지한다. 사업 정보의 오늘 현재 상태를 새로 확인했다는 뜻이 아니다. 만료된 snapshot은 기존 서비스 규칙에 따라 needs_verification이 될 수 있다.

복지까지 가상 자료만 사용하는 모드:

```powershell
pnpm exec tsx src/modules/be3-intelligence/hackathon-demo.ts synthetic
```

합성 사업 3건을 반환한다. 모두 `[합성]`/synthetic_demo/신청 불가로 표시한다. 두 모드 모두 HTTP 서버·DB·API 키·외부 네트워크가 필요 없다. llm 모드는 지원하지 않으며 API 키 환경변수가 있어도 실제 모델을 호출하지 않는다. 성공 exit 0, 잘못된 모드나 검증 실패 exit 1 및 안전한 `{error:{code,message}}`로 종료한다.

## 시연 순서와 확인 결과

1. 기존 syntheticAnalysisFixture의 과거/현재 불변 상담을 기존 SyntheticAnalysisProvider로 분석한다.
2. AnalysisWorkflow의 validateDraft와 권한 검사를 통과한다. 식사 3→2회, 외출 주 1회→못함, 매일 복용→2일 미복용의 기록상 변화다. 건강 악화·진단·위험도 판정이 아니다.
3. 기존 review에서 질문 수정 → submit → approve를 순서대로 실행한다. 버전은 2 → 3 → 4가 된다. 원본은 유지한다.
4. 기존 published 승인 게이트를 통과한 뒤 원문 인용과 과거/현재 양쪽 버전을 다시 검증한다.
5. 이 고정 합성 사례만을 위한 명시적 체크리스트로 식사/이동/복약을 simulated_staff_confirmed로 기록한다. 각 항목은 승인 분석 ID/버전과 finding_id를 참조한다.
6. 지역·연령·소득은 null/null/unknown을 유지한 채 기존 WelfareRecommendationService를 호출한다.
7. 반환 후보의 미확인 자격 상태·사업명·출처·확인 시각·자료 상태·matched_needs·basis를 기존 서비스의 카탈로그 조회와 대조한다.

필요 영역 체크리스트와 승인 행위는 **합성 CLI 시연의 명시적 모의 담당자 행동**이다. 임의 분석/실제 상담을 자동으로 needs로 변환하거나 승인하는 운영 통합을 구현한 것이 아니다. 기존 반려/동시 승인 충돌/권한 철회 검증은 기존 테스트로 유지한다. 실제 BE1/BE2 연결은 하지 않는다.

## FE 화면별 필드

새 JSON은 업무 API가 아닌 합성 시연용 projection이다. 기존 API 계약을 바꾸지 않는다. `examples/hackathon-demo.official-snapshot.json` 및 `examples/hackathon-demo.synthetic.json`에 실제 CLI 실행 결과를 저장했다. UUID와 검토 시각은 실행마다 달라진다.

| 화면/영역 | 핵심 필드 | 표시 규칙 |
| --- | --- | --- |
| 공통 배지 | data.demo.provider_kind, real_llm_called, synthetic_input, review_mode, warning | 항상 “Mock·합성 시연”, “담당자 승인도 시연” 표시. 실제 AI 모델 실행으로 표시 금지 |
| 상담 변화 | data.analysis.findings[].text/change | 숫자·부정 표현을 그대로 표시. worsened를 건강 악화로 번역하지 않음 |
| 원문 근거 펼치기 | findings[].evidence[].consultation_id/record_version_id/quote, analysis.input_versions | 정확한 인용과 불변 상담 버전을 함께 표시. 인용 검증은 의미적 정확성 보증이 아님 |
| 검토 | analysis.review_state/version/questions/review_history/original_preserved | approved 옆에 “시연용 승인” 표시. 이력의 action/actor_id/at/version 표시 |
| 필요 영역 | data.needs[].need/label/status/finding_id/analysis_id/analysis_version | simulated_staff_confirmed는 “담당자 확인(시연)”. 실제 돌봄 필요 판정으로 표현하지 않음 |
| 미확인 정보 | data.unknown_information | 지역·연령·소득 미확인 유지. 기본값을 넣어 추정하지 않음 |
| 복지 카드 | data.welfare.candidates[].program_name/reason/matched_needs/basis | 사업 안내와 연결된 후보 근거로 표시 |
| 출처·조건 | candidates[].data_status/source_url/checked_at/missing_information/warning | 안내 확인 상태와 개인 자격을 구분. synthetic_demo는 가상 자료 배지 필수 |
| 미매칭 필요 | data.welfare.unmatched_needs | “별도 확인할 필요 영역” 표시. 지원 제도가 없다고 단정하지 않음 |
| 수급 안내 | candidates[].eligibility_status, welfare.disclaimer | 항상 unverified. 승인/수급 가능/확정/적격률로 표시 금지 |

기본 공식 snapshot은 식사·이동과 관련된 후보를 보여주며 복약은 unmatched_needs에 남긴다. 복약 필요의 담당자 확인과 해당 필요에 대한 실제 사업 후보의 존재는 서로 다른 상태다. 합성 모드는 세 영역 모두 가상 후보를 보여주지만 실제 제도라고 설명하면 안 된다.

## 최소 변경과 시연 위험

새 wrapper·테스트·화면 필드 문서·JSON 예시만 추가했다. PR #6/#7/#9의 엔진/스키마/라우터는 수정하지 않았다. LLM 어댑터도 보존하며 이번 시연에서는 import하거나 호출하지 않는다. 별도의 사업 대량 수집·장기 추세 분석·추가 DB/서버/프레임워크는 없다.

미승인/실패 분석, 가상 인용, 잘못된 버전, 원본 변조, 후보 근거 불일치는 성공 JSON으로 내보내지 않는다. 실제 사용자 인증·임의 상담 매핑·담당자 인계·영속 저장소·운영 공개는 미구현이다. 서비스 저장소는 인메모리이며 매 실행마다 새로 생성된다. 복지 정보 최신성/실제 자격/LLM 품질은 이번 로컬 시연으로 검증되지 않는다.

검증 명령은 `pnpm typecheck`, `pnpm test`, `pnpm build`, `git diff --check`다. 기존 세 PR 회귀 190건과 새 시연 테스트를 함께 실행한다. 외부 fetch를 금지하고 기존 Supertest는 localhost만 사용한다.
