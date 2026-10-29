# CareGap 공통 계약 초안 v0.1
근거: CareGap_Backend_3_Roles.md 제안서 v1.0. 확정 정책이 아니며 BE1·BE2·BE3 및 FE 리뷰 필요.

- API: /api, JSON. 성공 {data}, 실패 {error:{code,message}}. 400 INVALID_REQUEST, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT, 500 INTERNAL_ERROR.
- ID: UUID 문자열 제안. user_id는 행위자 계정, person_id는 대상자, staff_id는 담당자 식별자. staff_id와 user_id의 동일성은 BE1 결정 전 가정하지 않음.
- appointment_id는 예약, consultation_id는 상담 기록, record_version_id는 불변 원문 버전. AI는 consultation_id와 record_version_id를 함께 참조.
- 시간: RFC3339 UTC, 화면 Asia/Seoul. 목록은 cursor/limit 및 next_cursor 제안. 세부 상한은 미정.
- actor: user_id + role(patient/family/staff/admin). 역할 이름은 확정이다. BE1 users.role CHECK와 requireRole이 같은 네 값을 쓴다. 역할 이름이 맞는 것은 승인·배정·가족 연결·동의가 끝났다는 뜻이 아니다. patient, staff, admin 역할만으로 상담 원문을 열지 않는다. 그 검사는 매 요청마다 서버에서 한다. AuthorizationPort 제공 전 업무 경로 미노출.
- 개발 X-Test-Actor는 명시적 opt-in 상태에서 /api/dev/actor에만 사용. 인증 수단이나 관계 증명이 아니며 운영에서 경로 차단. 운영 opt-in은 시작 오류.
- BE1: 인증·사용자·관계·관리자, BE2: 예약·상담 기록/버전·후속 업무·알림, BE3: media/OCR/STT/분석/검토/복지 후보.
- BE3 초안 경로: /api/media, /api/ocr, /api/transcripts, /api/analyses, /api/analysis-reviews, /api/welfare-programs. 아직 구현/확정되지 않음.
- 분석 상태: queued/running/succeeded/failed. unknown과 unchanged 구분. 입력 버전/인용 검증 실패는 성공 금지. 원본/교정본/AI 초안/검토본/공개본 분리.
- 분석 요청 Idempotency-Key: actor+operation+key 범위, 동일 키 다른 입력 409 제안. 보존 기간은 미정.
- 이벤트 초안: analysis.succeeded / analysis.failed {event_id,occurred_at,analysis_id,consultation_id,record_version_id,person_id}. at-least-once 전제 수신 중복 제거, BE2 알림 담당. 전송 방식 미정.
- 가족 공개 범위, 녹음/AI 동의 및 철회, 기록 수정 후 재분석, 자동 시작/후속업무, 복지 출처/갱신 주기, 실시간 통화·모바일 네이티브는 미확정.
- 복지 결과는 자격 미확인 후보 및 공식 출처/확인일 제공. 자동 수급 판정 금지. 실제 개인정보 없이 합성 fixture 사용.
