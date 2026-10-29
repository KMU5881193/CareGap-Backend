# Appointment consultation type — design draft (Wave A)

## 현재 구조 (저장소 사실)

`migrations/drafts/0002_be2_consultations.sql`의 `appointments`:

- `appointment_id`, `person_id`, `staff_user_id`, `requester_user_id`
- `starts_at`, `ends_at`, `status text` (열린 문자열, ENUM 아님)
- 전화/대면 등 **상담 유형 컬럼 없음**

`pnpm migrate`는 `migrations/drafts/`를 적용하지 않는다.
0002 초안 자체도 아직 `migrations/`로 승격되지 않은 상태일 수 있다.

## 제안 (미적용)

호환 additive 컬럼:

- 이름 후보: `consultation_type` (**DECISION REQUIRED** — 최종 명칭 팀 합의)
- 타입: `text NULL` (초기). NOT NULL/CHECK는 백필·기본값 합의 후
- 값 후보: `PHONE` 등. 닫힌 ENUM으로 바꾸지 말 것 (기존 `status`와 동일 방침)
- 기본값/백필: **DECISION REQUIRED** — 조사 전 금지
- 기존 행: NULL 허용 시 Call Eligibility는 `consultation_type_missing`으로 DENY

## 상태 문자열

`status` 확정값 집합은 **DECISION REQUIRED**.
테스트 fixture의 `confirmed`는 예시일 뿐 운영 계약이 아니다.
조사 없이 PostgreSQL ENUM으로 바꾸지 않는다.

## Draft SQL

`migrations/drafts/0003_be2_appointment_consultation_type.sql`

- 적용 금지 (이번 Wave)
- 공유/운영 DB 변경 금지
