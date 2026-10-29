# BE2 알림 초안

이 문서는 순수 함수의 범위다. 라우트, DB, 푸시 발송, 분석 이벤트 구독이 아니다. 공통 계약은 `docs/contracts.md`가 우선한다.

함수는 `notification.ts`의 `acceptNotification`, `markNotificationRead`, `listNotifications`, `revertNotificationRead`, `removeNotification`이다.

## 현재 브랜치에서 확인한 사실

`feature/be2-notification-domain`의 HEAD는 `0ae0a68`이고, 이 커밋은 `feature/be2-follow-up-domain`과 같다. `5f37ea5`는 이 브랜치의 조상이 아니다. 작업 트리에 `analysis-event.ts`가 없다. 병합하지 않았고, 이 모듈은 그 파일을 import 하지 않는다.

`src/shared/contracts.ts`의 역할 이름은 아직 `person | family | staff | admin`이다. 합의된 `patient`로의 변경은 이 단계에서 하지 않는다. 이 모듈은 역할 목록을 새로 만들지 않는다. `person_id`는 상담 대상자 식별자다. `recipient_user_id`는 알림을 받는 사용자 계정 id다. 둘을 같은 값으로 채우지 않는다.

## 알림

한 알림의 식별자는 `notification_id`다. 같은 `event_id`에 서로 다른 알림이 있을 수 있다. 접수 중복은 알림 식별자로만 판단한다. UUID 철자는 유지하고, 같은 식별자인지는 대소문자를 무시한다. 시각이 같은 RFC3339 UTC는 철자가 달라도 같은 시각으로 본다.

항상 있는 필드는 `notification_id`, `recipient_user_id`, `kind`, `title`, `body`다. `kind`는 비어 있지 않은 문자열이다. 알림 종류 목록이 아니다. `fixture-notice` 같은 테스트 문자열은 제품 종류가 아니다. `title`과 `body`의 빈 문자열과 길이 상한은 정하지 않았다. `body`는 호출자가 적은 표시 문장이다.

`event_id`, `appointment_id`, `follow_up_id`, `person_id`, `created_at`은 호출자가 넣을 때만 저장한다. 현재 시각을 찍지 않는다. 예약과 후속 업무가 실제로 있는지는 보지 않는다. 상담 원문, 인용, 분석 결과, 읽음 시각, 발송 시각은 접수 입력이 아니다.

빠진 `event_id`의 정책이 `unset`이면 `policy_unset`이다. `required`이면 `event_required`다. `appointment_id`와 `follow_up_id`가 둘 다 없고 대상 정책이 `unset`이면 `policy_unset`이고, `required`이면 `subject_required`다. `person_id`만 있는 것은 예약이나 후속 업무 연결을 대신하지 않는다. 있는 필드는 정책이 `unset`이어도 그 이유로 거절하지 않는다. 이 구분은 어떤 변경에 알림을 보낼지의 결정이 아니다.

## 접수

같은 `notification_id`이고 내용이 같으면 `duplicate`다. 목록에 다시 넣지 않고, 저장돼 있던 철자와 `read_at`을 유지한다. 같은 식별자인데 수신자, 종류, 문장, 연결 식별자, 생성 시각이 다르면 `conflict`다. 기존 알림은 바꾸지 않는다. 충돌 결과에는 제목과 본문을 넣지 않는다.

`event_id`가 있는데 `event_repeat`가 `unset`이면 새 알림을 만들지 않고 `policy_unset`이다. 호출자가 `allow`를 넣으면 같은 이벤트에 다른 알림 식별자를 추가할 수 있다. 호출자가 `reject`를 넣으면 이미 그 이벤트를 가리키는 알림이 있을 때 `event_repeat_rejected`다. `reject`는 수신자나 종류까지 나눈 규칙이 아니다. 같은 알림 식별자의 재접수는 이 정책과 별개다.

## 읽음

읽지 않은 알림에만 `read_at`을 쓴다. 이미 `read_at`이 있으면 `already_read`이고 처음 시각을 유지한다. 다시 읽지 않은 상태로 되돌리는 함수는 `policy_unset`만 반환한다. 삭제도 같다. 두 함수는 목록을 받지 않으며 알림을 바꾸지 않는다.

`read_at`은 푸시를 보냈다는 뜻이 아니다. 이 모듈에는 발송 상태 필드가 없다.

## 접근

`verified: false`와 `allowed: false`는 접수, 읽음, 목록, 되돌리기, 삭제를 하지 않는다. `{ verified: true, allowed: true }`는 호출자가 만든 값이다. `AuthorizationPort`를 호출했다는 증거가 아니다. `role`은 입력이 아니다.

목록과 읽음은 `recipient_user_id`가 호출자가 넘긴 사용자 id와 같을 때만 알림을 반환한다. `event_id`만으로 목록을 만들지 않는다. 이벤트 id를 넘겨도 그 사용자의 알림만 남긴다. 다른 수신자면 읽음 처리는 `recipient_mismatch`이고 제목과 본문은 반환하지 않는다. 공개 응답에서는 이 사유와 `notification_not_found`를 같은 없음으로 다루어야 한다. 대상자 `person_id`나 역할이 같다는 이유만으로 알림을 반환하지 않는다.

실패 결과에는 제목, 본문, 상담 원문을 넣지 않는다.

## 분석 이벤트와 후속 업무

공통 계약 초안의 `analysis.succeeded`와 `analysis.failed`는 이 모듈의 종류 목록이 아니다. 분석 이벤트 객체를 접수 입력으로 넣으면 알림이 되지 않는다. 분석 성공은 후속 업무 확정이 아니다. 이 모듈은 후속 업무를 만들지 않고, 후속 업무를 만들었다는 이유로 알림이 생겼다고 보지 않는다.

## 객체

입력 배열과 입력 객체는 바꾸지 않는다. 반환 알림과 목록 안의 알림은 서로 다른 객체다. 거절 결과는 호출마다 새로 만든다. 이후 호출이 앞서 반환한 목록을 바꾸지 않는다.

## DB에 넣을 때

이 함수는 동시에 같은 `notification_id`를 두 번 넣는 경우를 막지 않는다.

- `notification_id`는 대소문자를 무시한 고유 제약으로 둔다. 제약 위반이면 기존 행을 유지한다. 다른 내용으로 갱신하지 않는다.
- `event_id`에는 고유 제약을 두지 않는다. 수신자와 종류를 포함한 고유 제약은 아직 합의되지 않았다.
- 사용자별 조회는 저장소 조건에서 `recipient_user_id`를 제한한다. 이벤트로 모든 행을 읽은 뒤 거르지 않는다.
- `read_at`이 없는 행이 읽지 않은 알림이다. 발송 시각 컬럼은 이 단계에서 만들지 않는다.
- 상담 원문 컬럼은 만들지 않는다.
- `recipient_user_id`의 사용자 FK는 BE1 사용자 테이블이 확인된 뒤다.

## 미확정

- 어떤 예약 변경, 후속 업무 변경, 기한, 분석 성공, 분석 실패에 알림을 만드는가
- 수신자를 누구로 고르는가
- 알림이 이벤트를 반드시 가리켜야 하는가
- 한 이벤트의 알림을 수신자나 종류마다 하나씩만 둘 수 있는가
- 알림을 삭제할 수 있는가
- 읽음을 되돌릴 수 있는가
- 알림을 얼마나 보관하는가
- `title`과 `body`의 빈 문자열과 길이 상한
- 생성 시각이 항상 필요한가
