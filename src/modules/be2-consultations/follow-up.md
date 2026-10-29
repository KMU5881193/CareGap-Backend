# BE2 후속 업무 초안

이 문서는 순수 함수의 범위다. 라우트, DB, 알림, 분석 이벤트 구독이 아니다. 공통 계약은 `docs/contracts.md`가 우선한다.

함수는 `follow-up.ts`의 `createFollowUp`, `reviseFollowUp`, `transitionFollowUp`이다.

## 현재 브랜치에서 확인한 사실

`feature/be2-follow-up-domain`의 HEAD는 `8f9ec30`이다. `feature/be2-analysis-event-domain`의 `5f37ea5`는 이 브랜치에 포함되어 있지 않다. 병합하지 않았다. 분석 이벤트 모듈은 그 커밋을 읽어 연결 방식만 기록한다. 이 브랜치의 후속 업무 코드는 그 모듈을 import 하지 않는다.

공통 Actor 역할은 `patient | family | staff | admin`이다. 이 모듈은 역할 목록을 새로 만들지 않는다. `person_id`는 상담 대상자 식별자다.

## 업무

한 업무의 식별자는 `follow_up_id`다. 같은 출처 `record_version_id`에 서로 다른 업무가 있을 수 있다. 중복은 업무 식별자로만 판단한다. UUID 철자는 유지하고, 같은 식별자인지는 대소문자를 무시한다.

항상 있는 필드는 `follow_up_id`, `person_id`, `title`, `status`다. `title`의 빈 문자열과 길이 상한은 정하지 않았다. `status`는 비어 있지 않은 문자열이다. 상태 이름 목록은 아니다.

`consultation_id`와 `record_version_id`는 둘 다 있거나 둘 다 없어야 한다. 둘 다 있으면 `readRecordVersion`으로 상담·버전·`person_id`가 맞는지 본다. 맞은 뒤에는 그 식별자를 내용 수정이나 상태 변경으로 바꾸지 않는다. 새 상담 기록 버전이 생겨도 이 함수가 출처를 다시 쓰지 않는다.

`assignee_user_id`는 담당 사용자의 `user_id`다. 인증된 요청자와 같지 않다고 가정하지 않고, 이 함수가 요청자 식별자를 담당자로 복사하지도 않는다. `due_at`, `created_at`, `updated_at`은 호출자가 넣을 때만 저장한다. 현재 시각을 찍지 않는다.

출처, 담당자, 기한이 빠져 있을 때 그 필드의 정책이 `unset`이면 업무를 만들지 않고 `policy_unset`을 반환한다. 이것은 수동 생성 허용도, 금지도 아니다. 호출자가 `optional` 또는 `required`를 넣은 경우에만 그 선택을 따른다.

## 상태

상태 전이는 `{ from, action, to }` 규칙만 해석한다. 예약 전이 규칙과 달리 역할을 받지 않는다. 역할이 맞다는 것은 대상자 접근 권한이 아니다. 규칙이 없으면 `policy_unset`이고, 맞는 규칙이 없으면 `illegal_transition`이다. 완료 업무를 다시 열 수 있는지는 규칙으로만 표현한다. 기본 표는 없다.

`fixture-open` 같은 테스트 문자열은 제품 상태명이 아니다.

## 접근

`verified: false`와 `allowed: false`는 생성·수정·전이를 하지 않는다. `{ verified: true, allowed: true }`는 호출자가 만든 값이다. `AuthorizationPort`를 호출했다는 증거가 아니다. `role`은 입력이 아니다.

권한 확인 전에는 버전 존재 사유를 반환하지 않는다. `version_not_found`, `consultation_mismatch`, `ambiguous_version`을 공개 오류로 구분하면 상담 기록의 존재가 드러난다. 공개 응답에서는 같은 없음으로 다루어야 한다.

실패 결과에는 상담 원문과 업무 제목을 넣지 않는다. `RecordReader`는 권한이 아니므로 외부 요청의 조회 수단으로 쓰지 않는다. 출처 확인은 `readRecordVersion`이며, 반환 업무에는 원문을 복사하지 않는다.

## 분석 이벤트

분석 성공은 후속 업무 생성이 아니다. 이 모듈은 이벤트를 받아 업무를 만들지 않고, 후보와 확정 업무를 한 상태로 두지 않는다. 상담 기록 → 분석 → 후보 → 상담사 확인 → 등록은 이후 단계다. 알림과 복지 추천도 만들지 않는다.

## DB에 넣을 때

이 함수는 동시에 같은 `follow_up_id`를 두 번 넣는 경우를 막지 않는다.

- `follow_up_id`는 대소문자를 무시한 고유 제약으로 둔다.
- 제약 위반이면 기존 행을 유지한다. 다른 내용으로 갱신하지 않는다.
- `consultation_id`와 `record_version_id`는 생성 후 바꾸지 않는 컬럼으로 둔다.
- 담당자 컬럼은 사용자 `user_id`다. 별도 상담사 테이블 식별자를 만들지 않는다.
- 사용자 FK는 BE1 사용자 테이블이 확인된 뒤다.
