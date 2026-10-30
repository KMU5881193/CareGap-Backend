# BE2 로컬 시연 API

이 문서는 로컬 시연 하네스의 HTTP다. `src/app.ts`에는 이 경로가 없다. 운영 서버의 Base URL은 없다.

로컬 Base URL은 `http://127.0.0.1:4010`이다. 다른 주소로 열지 않는다.

## 실행

폐기용 데이터베이스만 사용한다. `caregap_local`과 팀 공유 데이터베이스에는 적용하지 않는다.

```powershell
docker run -d --name caregap-be2-demo -e POSTGRES_PASSWORD=local-only -e POSTGRES_DB=caregap_be2_demo -p 127.0.0.1:55434:5432 postgres:16
$env:NODE_ENV = 'development'
$env:BE2_DEMO_DATABASE_URL = 'postgres://postgres:local-only@127.0.0.1:55434/caregap_be2_demo'
$env:BE2_DEMO_PORT = '4010'
pnpm demo:be2
```

`NODE_ENV=production`이면 시작하지 않는다. 프로세스를 다시 실행하면 상담·후속 업무·알림·예약 시드를 지우고 같은 합성 데이터로 다시 넣는다. 종료는 Ctrl+C다. 컨테이너 제거는 `docker rm -f caregap-be2-demo`다.

준비 확인:

```http
GET /health
```

```json
{ "data": { "status": "ok", "mode": "local-demo" } }
```

## 인증

`Authorization: Bearer demo-staff`만 대상자 `dddddddd-dddd-4ddd-8ddd-dddddddddddd`의 기록을 다룬다. 이 값은 BE1 세션이 아니다. 요청 본문의 사용자 ID와 역할은 쓰지 않는다.

| 토큰 | 결과 |
|---|---|
| 헤더 없음 | 401 `Authentication required` |
| `Bearer` 형식이 아님, 또는 목록에 없는 토큰 | 401 `Invalid demo token` |
| `demo-pending` | 403 `Demo account is not approved` |
| `demo-other-staff`, `demo-family`, `demo-admin` | 대상자 기록 404 `Not found` |

`demo-family`에는 가족 연결이 없다. `demo-admin`은 역할만 있다. 둘 다 기록을 열지 못한다. 이 표는 시연용 허용 목록이다. BE1 배정·가족 관계 검증이 아니다.

## 공통 형식

성공은 `{ "data": ... }`다. 실패는 `{ "error": { "code", "message" } }`다.

오류 코드는 `INVALID_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`다.

## 상담사 화면 호출 순서

아래 ID는 시연에서 새로 만드는 값이다. 이미 들어 있는 과거 기록은 따로 있다.

1. 과거 목록: `GET /api/be2/consultations?person_id=dddddddd-dddd-4ddd-8ddd-dddddddddddd`
2. 과거 원문: `GET /api/be2/consultations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`
3. 새 상담: `POST /api/be2/consultations`
4. 새 버전: `POST /api/be2/consultations/{consultation_id}/versions`
5. 후속 업무: `POST /api/be2/follow-ups`에 방금 만든 `consultation_id`와 `record_version_id`를 함께 넣는다
6. 확인: `GET /api/be2/follow-ups?person_id=dddddddd-dddd-4ddd-8ddd-dddddddddddd`
7. 제목 수정: `PATCH /api/be2/follow-ups/{follow_up_id}`

### 과거 목록

```http
GET /api/be2/consultations?person_id=dddddddd-dddd-4ddd-8ddd-dddddddddddd
Authorization: Bearer demo-staff
```

```json
{
  "data": [
    {
      "consultation_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "person_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "appointment_id": null
    }
  ]
}
```

목록에는 원문이 없다.

### 과거 원문

```http
GET /api/be2/consultations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
Authorization: Bearer demo-staff
```

```json
{
  "data": {
    "consultation_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "record_version_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "person_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "text": "합성 기록: 지난 상담에서 서류 목록을 안내했습니다."
  }
}
```

### 새 상담

```http
POST /api/be2/consultations
Authorization: Bearer demo-staff
```

```json
{
  "consultation_id": "10101010-1010-4101-8101-101010101010",
  "person_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "record_version_id": "20202020-2020-4202-8202-202020202020",
  "text": "합성 기록: 이번 상담에서 제출 서류의 순서를 정리했습니다."
}
```

`201`의 `data`는 `outcome`, `consultation_id`, `person_id`, `record_version_id`다. 응답에 원문을 다시 담지 않는다. `consultation_id`와 `record_version_id`는 클라이언트가 UUID로 보낸다.

### 새 버전

같은 `consultation_id`에 새 `record_version_id`를 보낸다. 이전 행은 바꾸지 않는다.

```http
POST /api/be2/consultations/10101010-1010-4101-8101-101010101010/versions
Authorization: Bearer demo-staff
```

```json
{
  "record_version_id": "30303030-3030-4303-8303-303030303030",
  "text": "합성 기록: 제출 순서를 한 번 더 확인했습니다."
}
```

`201`:

```json
{
  "data": {
    "consultation_id": "10101010-1010-4101-8101-101010101010",
    "record_version_id": "30303030-3030-4303-8303-303030303030",
    "person_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
  }
}
```

이전 버전 `20202020-2020-4202-8202-202020202020`의 원문은 그대로다. 상세 조회는 `GET /api/be2/consultations/{consultation_id}`이고 `record_version_ids`만 돌려준다.

### 후속 업무

`consultation_id`와 `record_version_id`는 둘 다 있거나 둘 다 없어야 한다. 버전은 그 상담의 버전이어야 하고 `person_id`가 같아야 한다. `status`는 비어 있지 않은 문자열이다. `fixture-open`은 시연용 값이며 완료 상태가 아니다.

```http
POST /api/be2/follow-ups
Authorization: Bearer demo-staff
```

```json
{
  "follow_up_id": "40404040-4040-4404-8404-404040404040",
  "person_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "title": "서류 순서 안내",
  "status": "fixture-open",
  "consultation_id": "10101010-1010-4101-8101-101010101010",
  "record_version_id": "30303030-3030-4303-8303-303030303030"
}
```

목록은 `GET /api/be2/follow-ups?person_id=dddddddd-dddd-4ddd-8ddd-dddddddddddd`다.

제목 수정:

```http
PATCH /api/be2/follow-ups/40404040-4040-4404-8404-404040404040
Authorization: Bearer demo-staff
```

```json
{ "title": "서류 순서 재안내" }
```

상태 변경 API `POST /api/be2/follow-ups/{id}/actions`는 있다. 시연 서버의 전이 규칙이 비어 있으므로 `409 Conflict`가 되고 상태는 바뀌지 않는다.

## 알림

시드 알림의 제목은 `후속 업무`, 본문은 `후속 업무가 등록되었습니다.`다. 상담 원문을 넣지 않는다. 푸시는 보내지 않는다. `read_at`은 읽음 시각이다.

```http
GET /api/be2/notifications
Authorization: Bearer demo-staff
```

```http
POST /api/be2/notifications/22222222-2222-4222-8222-222222222222/read
Authorization: Bearer demo-staff
```

```json
{ "read_at": "2026-10-30T04:00:00.000Z" }
```

다른 계정의 읽음 요청과 없는 알림은 같은 `404 Not found`다. `POST /api/be2/notifications`는 호출자가 `title`과 `body`를 넣는다. 서버가 그 문장을 안전한 템플릿으로 다시 쓰지 않는다. 시연에서는 위 문장만 쓰고, 외부 사용자에게 보내지 않는다.

## 예약

이미 있는 일정 조회:

```http
GET /api/be2/appointments?person_id=dddddddd-dddd-4ddd-8ddd-dddddddddddd
Authorization: Bearer demo-staff
```

시드 한 건의 `appointment_id`는 `50505050-5050-4505-8505-505050505050`, `status`는 `fixture-held`다. 이 상태는 제품 상태가 아니다. 응답에 `staff_user_id`는 없다.

`POST /api/be2/appointments`는 `409 Conflict`이며 행을 만들지 않는다. 상담사 일정은 `GET /api/be2/appointments?staff_user_id=`이고, 그 값이 로그인한 사용자와 같을 때만 반환한다.

## 시각

UTC이며 `Z`로 끝나야 한다. `+09:00`은 거부된다.

## 운영 API와의 차이

| | 로컬 시연 | 운영 `src/app.ts` |
|---|---|---|
| BE2 경로 | `127.0.0.1`에서만 | 404 |
| 인증 | 문서의 Bearer 토큰 | 없음. BE1 미들웨어는 이 브랜치에 없음 |
| 데이터 | 재시작마다 합성 시드 | 연결하지 않음 |
| 예약 생성 | 409 | 경로 없음 |
