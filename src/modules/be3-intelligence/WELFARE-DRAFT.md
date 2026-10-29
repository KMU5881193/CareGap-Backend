# BE3 복지사업 후보 추천 초안

최신 origin/main `3f57faad334e04fa39bcfa4a0c901e5205b02242` 기준의 독립 구현이다. PR #6/#7 분석 서비스·LLM 출력과 연결하지 않는다. 공통 계약/OpenAPI/인증 구현/BE1/BE2/FE/DB/마이그레이션/환경 설정/운영 앱·서버 진입점을 변경하지 않는다.

## 데이터와 확인 범위

공식 snapshot은 **노인맞춤돌봄서비스 1건**이다. [보건복지부 공식 안내](https://www.mohw.go.kr/menu.es?mid=a10712010400)를 2026-10-29 11:26:22 UTC에 열어 확인했다. 페이지 표기 최종수정일은 2026-03-31이다. 사업명, 대상 조건, 신청 기관, 식사관리/외출동행 관련 안내를 제한적으로 수동 반영했다. 금액·소득 금액 기준·신청 기한은 저장하거나 생성하지 않았다. 개별 대상자 조사·최종 자격을 확인한 것이 아니다.

정부24 상세 페이지는 접속 제한 화면이 포함되어 있어 검증 근거로 채택하지 않았다. 복지로 검색 결과도 별도의 확인 완료 자료로 저장하지 않았다. 자동 크롤링/유료 API/키 서비스/동기화는 없다.

`verified_official`은 수동으로 공식 안내를 확인한 snapshot의 상태이며 이용자의 적격 판정이 아니다. 런타임은 HTTPS·정부 도메인·확인 시각·지원 관련 짧은 발췌의 존재를 검증하지만 URL만으로 사실을 인증하지 않는다. 포트에 새 자료를 공급하는 관리자가 실제 공식 원문과 조건을 검증해야 한다. 소스 발췌도 런타임 재접속으로 대조하지 않는다.

검증한 snapshot이 30일을 초과하면 읽기 시 `needs_verification`으로 낮추고 재확인 조건을 추가한다. 30일은 BE3 내부 초안이며 정부의 갱신·신청·유효기간이 아니다. 원래 URL·checked_at은 보존한다. 미래 checked_at/잘못된 스키마/중복 ID는 CATALOG_INVALID로 거부한다.

합성 카탈로그는 `[합성]` 접두어의 가상 사업 3건이다. 실제 제도/기관/지원금/신청 경로가 아니며 source_url/checked_at은 null이다. `officialWelfareCatalog()`와 `syntheticWelfareCatalog()`를 명시적으로 분리하여 기본 데모에 실제·가상 사업을 섞지 않는다. 모든 테스트는 합성 자료를 사용하고 외부 네트워크를 호출하지 않는다. Supertest는 localhost HTTP만 사용한다. 상태 검증 테스트의 정부 URL 모양 자료도 실제 사업 자료가 아니다.

## 모델과 추천 규칙

WelfareProgram은 요청된 14개 필드를 포함한다. id는 BE3 내부 slug이고 person_id는 공유 UUID Id를 사용한다. region은 `{scope:"national"}`, `{scope:"regional",code:"seoul"}`, `{scope:"unknown"}`을 구분한다. age_groups의 null은 알려진 연령 조건이 없음을 뜻하며 모든 연령의 자격을 보장하지 않는다.

need_links는 필요 영역과 사업 안내상 지원 조건/발췌를 연결한다. income_review_required는 소득·수급 관련 추가 확인 필요 여부다. required_conditions는 담당자가 확인할 조건 목록이며 자동 충족 판정값이 아니다.

추천 입력은 person_id, needs, region, age_group, income_status만 받는다. 이름/전화/주소/상담 원문/소득 금액/진단 필드는 거부한다. needs는 meal_support/mobility_support/medication_management 중 중복 없는 1~3개다. region은 17개 광역지역의 BE3 내부 영문 코드 또는 null이다. 실제 주소를 받지 않는다. age_group은 under_18/age_18_to64/age_65_plus 또는 null이다. income_status는 unknown/self_reported_low/self_reported_other다. 자가보고를 공식 소득·수급 확인으로 취급하지 않는다.

1. 기존 Actor와 입력 스키마 검증 후 BE1 analyze 권한 검사
2. 개인정보/needs를 인수로 보내지 않고 catalog.list() 호출
3. 카탈로그 검증·snapshot 최신성 처리 후 권한 재검사
4. need_links가 겹치는 사업만 후보화
5. 명확한 지역·연령 불일치는 제외; unknown은 확인 조건으로 유지
6. 카탈로그의 조건/발췌로 추천 근거 작성; 필수 조건과 출처·소득 등 확인 사항 반환
7. 일치 필요 수가 많은 순서, 동일하면 ID 순서로 정렬

점수·확률·퍼센트·수급 확정은 없다. eligibility_status는 항상 unverified다. 실제 지원이나 금액을 생성하지 않는다. 추천되지 않은 필요는 unmatched_needs에 남긴다. 예를 들어 공식 snapshot에는 복약 지원을 임의로 붙이지 않으므로 medication_management는 미매칭이다. unknown 지역을 전국 지원으로 바꾸지 않는다. 소득 확인 조건이 있는 사업은 자가보고가 있어도 공식 확인 사항을 유지한다.

## 독립 API 계약

`createWelfareRouter(service, authenticate)`는 BE1 인증 함수 주입이 필수다. 테스트 헤더 인증이나 운영 마운트는 없다. 성공 `{data}`, 실패 `{error:{code,message}}`.

- `GET /api/welfare-programs`: 인증된 일반 카탈로그 조회. q/need/region/age_group/data_status/limit/offset 검색 지원. 기본 limit 20, 최대 100, offset 0~250. 결과는 programs/total/next_offset/disclaimer. 지역·연령 필터는 조건이 명시된 일치만 반환하며 불명확한 조건을 일치로 간주하지 않는다.
- `GET /api/welfare-programs/:id`: 단일 사업 조회, 미존재 ID 404.
- `POST /api/welfare-recommendations`: 매 요청 person_id에 대한 analyze 권한을 확인하는 개인별 후보 탐색.

```json
{
  "person_id": "00000000-0000-4000-8000-000000000002",
  "needs": ["meal_support", "mobility_support", "medication_management"],
  "region": null,
  "age_group": null,
  "income_status": "unknown"
}
```

응답은 person_id/algorithm:"rules-v1"/candidates/unmatched_needs/disclaimer다. 후보마다 program_id/program_name/reason/eligibility_status:"unverified"/matched_needs/basis/region_match/missing_information/source_url/checked_at/data_status/application_method/warning을 반환한다. region_match는 unknown/national/same_region이며 불일치는 반환 전에 제외된다. 출처 없는 needs_verification도 후보로 보일 수 있지만 공식 출처·최신성 확인 조건과 미검증 경고를 붙이고 URL을 발명하지 않는다. synthetic_demo는 실제 신청 불가를 명시한다.

400 INVALID_REQUEST, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND, 413 INVALID_REQUEST, 503 CATALOG_UNAVAILABLE/CATALOG_INVALID, 500 INTERNAL_ERROR. 외부 포트·인증·스키마 예외의 상세 메시지를 공개하지 않는다. JSON 본문은 16 KiB로 제한한다. 모든 라우터는 독립 Supertest에서 검증하며 src/app.ts에 마운트하지 않는다.

## 시연과 FE 예시

```powershell
pnpm install --frozen-lockfile
pnpm exec tsx src/modules/be3-intelligence/welfare-demo.ts
```

기본값은 synthetic이다. 합성 상황·추천 후보·근거·미확인 조건을 JSON으로 출력하며 HTTP 서버/DB/외부 API/키 없이 실행한다. 공식 수동 snapshot을 같은 합성 입력으로 확인하려면 아래 명령을 사용한다. 이 명령도 네트워크로 최신 자료를 조회하지 않는다.

```powershell
pnpm exec tsx src/modules/be3-intelligence/welfare-demo.ts official_snapshot
```

`examples/welfare/recommendations.synthetic.json`은 기본 데모의 data를 API envelope로 저장한 실제 실행 예시이며 가상 사업만 포함한다. 입력 예시는 `examples/welfare/request.synthetic.json`이다. FE는 warning/data_status/disclaimer와 missing_information을 보여야 하며 verified_official을 개인 자격의 승인 표시로 바꾸면 안 된다. 신청 확정/자동 신청 동작은 없다.

## 연동 예정과 한계

- BE1: 실제 세션 인증과 현재 관계·배정·동의·철회 검사. 현재 공통 AuthorizationPort의 analyze를 보수적으로 재사용하며 welfare 전용 동작 구분은 추후 팀 합의가 필요하다. 역할만으로 접근을 허용하지 않는다. 일반 사업 목록은 개인 정보를 포함하지 않아 인증만 요구한다.
- BE2: 담당자가 확인한 구조화된 needs/지역/연령대/소득 상태를 전달하는 포트 또는 호출 경계. BE3가 상담 원문에서 건강·생활 수준·지역을 추론하지 않는다.
- PR #6/#7: 분석 결과의 검토 상태·근거·불변 버전을 확인한 뒤 구조화된 needs로 매핑하는 통합 어댑터를 추후 구현해야 한다. 현재 자동 연결은 없다.
- FE: API envelope와 unknown/null·출처 상태·조건 확인 의미에 대한 합의가 필요하다. 카탈로그 검색 결과와 개인별 추천은 다른 API다.

인메모리·수동 정적 자료이며 운영 영속 저장소/동기화/대규모 검색/갱신 담당 워크플로/전체 복지사업 포괄/실제 자격 심사/개인 프로필 신뢰성 검증/운영 BE1 연동은 미구현이다. structured input도 호출자가 확인한 사실만 보내야 한다. 외부 catalog 구현은 향후 주입할 수 있지만 이번 구현은 외부 연결을 만들지 않는다. DB 마이그레이션/운영 배포/유료 호출은 수행하지 않는다.
