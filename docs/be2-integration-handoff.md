# BE1·BE3 통합 전달

이 브랜치의 작업 트리에는 BE1 라우트와 `authenticateUser`가 없다. `main`은 읽기만 했다. BE1 파일은 복사하거나 수정하지 않았다.

## BE1에 요청할 것

`main`의 `src/shared/middleware/auth.middleware.ts`에는 `authenticateUser`, `requireApprovedUser`, `requireRole`, `AuthenticatedRequest`가 있다. `requireRole`은 역할 이름만 본다. `src` 아래에서 이 함수를 호출하는 라우트는 없다.

`GET /api/consultations/appointments`와 `GET /api/consultations/records`는 인증 없이 이름과 상담 요약을 반환한다. 데이터는 메모리 배열이다. 실제 저장소로 바꾸기 전에 인증과 대상자별 권한을 넣어 달라. 이 브랜치에는 그 라우트가 없어 여기서 고치지 않았다.

`POST /api/relationships/link`와 `GET /api/relationships/:patientIdentifier`도 인증이 없고, 관계는 프로세스 메모리 배열이다. `AuthorizationPort.canAccess(actor, personId, action)`에 연결할 배정·가족 테이블이 없다. 역할이 `staff` 또는 `admin`인 것만으로 상담 원문을 열면 안 된다.

BE2 라우터를 `src/app.ts`에 등록하는 작업은 그 포트가 실제 관계 조회로 구현된 뒤로 미룬다. `{verified:true, allowed:true}`는 그 증명이 아니다.

`main`의 `createApp` 오류 처리기는 `error.message`를 응답에 넣는다. 상담 원문이나 SQL이 메시지에 섞이면 그대로 나간다. 이 브랜치의 `src/app.ts`는 고정 문구만 반환한다.

## BE3에 전달할 계약

`analysis-event.ts`는 커밋 `5f37ea5`에 있고 이 작업 트리에는 없다. import하지 않았다. 분석 결과를 받는 HTTP API는 없다. 분석이 실행되거나 성공한 상태가 아니다.

접수 본문 필드는 `type`, `event_id`, `occurred_at`, `analysis_id`, `consultation_id`, `record_version_id`, `person_id`다. `type`은 `analysis.succeeded` 또는 `analysis.failed`다.

같은 `event_id`와 같은 내용이면 중복 접수다. 같은 `event_id`와 다른 내용이면 충돌이다. 버전은 `consultation_id`와 `record_version_id`로 찾고, `person_id`가 그 버전의 대상자와 같아야 한다. 맞지 않으면 거절한다.

접수 결과는 항상 `effects: { configured: false, reason: 'policy_unset' }`다. 알림을 만들지 않고 후속 업무도 만들지 않는다. 이벤트 접수와 알림 전송은 다른 작업이다. 후속 업무 자동 생성은 규칙이 없으므로 구현하지 않았다.

원문을 분석에 넘길 때 필요한 키는 저장된 `consultation_id`와 `record_version_id`다. 배열 순서를 최신 버전으로 쓰지 않는다.

## 시연에서 쓰지 않는 것

- 운영 앱의 BE2 등록
- 예약 생성
- 후속 업무 자동 생성
- 알림 푸시
- 분석 성공 처리
