# Call Eligibility (Phase 1 Wave A)

순수 판정 모듈: `src/modules/be2-consultations/call-eligibility.ts`.
HTTP 마운트·DB 쓰기·푸시·LiveKit·AuthorizationPort 호출 없음.

## 입력

- 예약 스냅샷: `appointment_id`, `status`, `consultation_type`, `starts_at`, `ends_at`, `person_id`, `staff_user_id`
- `actor.user_id` / `actor.role` (`patient` | `family` | `staff` | `admin` — 대소문자 변환 없음)
- `now` (UTC, `Z` 접미사)
- `policy` (호출자 주입; 미설정 필드면 DENY)
- `participation` (담당 배정 또는 Identity Resolver가 검증한 대상자 계정 바인딩)

## 정책

| 필드 | 의미 | 운영 기본값 |
|---|---|---|
| `allowedStatuses` | 통화 가능 예약 상태 목록 | **DECISION REQUIRED** (테스트만 `confirmed` 예시) |
| `requiredConsultationType` | 요구 상담 유형 | 명세상 `PHONE`; 컬럼 도입 전 값은 **DECISION REQUIRED** |
| `joinWindow.earliestBeforeStartMs` | 시작 전 허용 시각 | 명세 10분 = `600000` (제품 확정 전 코드에 운영 하드코딩하지 않음) |
| `joinWindow.latestRelativeTo` / `latestOffsetMs` | 참여 가능 종료 시각 | **DECISION REQUIRED** (`ends_at` vs 다른 앵커) |
| `allowedCallerRoles` | 허용 역할 | **DECISION REQUIRED** |

정책 배열이 `undefined`이거나 비어 있으면 DENY (`policy_unset_*`).

## ID 규칙

- `person_id`는 대상자 id이며 `user_id`가 아니다.
- `staff_user_id`는 `users(user_id)` FK다. 별도 `staff_id` 엔티티를 가정하지 않는다.
- 담당자 용량: `actor.user_id`와 `staff_user_id` 일치 + 역할 정책 + `assigned_staff` claim.
- 대상자 용량: Identity Resolver의 `PersonAccountBinding` (`verified: true`, `person_id`≠`user_id`).
- `AuthorizationPort` always-true 운영 우회 금지. 이 모듈은 포트를 호출하지 않는다.

## 스키마 제안

`docs/contracts/appointment-consultation-type.md` 및
`migrations/drafts/0003_be2_appointment_consultation_type.sql` 참고.
migration 적용·ENUM화·백필은 Wave A 범위 밖이다.
