# CareGap 통합 푸시 알림 및 WebRTC 전화 상담 — 백엔드 상세 명세서

> **문서 ID:** CG-BE-PUSH-CALL-SPEC-4P  
> **버전:** Draft v1.0 (4-Phase 통합본)  
> **작성 기준일:** 2026-10-30  
> **대상:** CareGap Backend / BE1·BE2·BE3 연동 담당자 / 프론트엔드 인터페이스 담당자  
> **상위 기준:** `CareGap_Final_Functional_Spec_v2.0(1).pdf` (2026-10-29, 21쪽)  
> **상태:** **구현 전 설계안 — 현재 저장소에 대한 직접 코드 검증, 통합 실행 또는 기기 테스트를 수행한 결과가 아님**

---

## 0. 결론과 범위

CareGap은 **하나의 백엔드 통화 제어 시스템**, **하나의 WebRTC 미디어 서버(LiveKit)**, **플랫폼별 착신 전송 어댑터**로 구성한다.

- **공통 음성통화:** iOS·Android가 같은 CareGap REST/WebSocket 계약과 LiveKit Room을 사용한다.
- **공통 일반 푸시:** FCM을 사용하되 iOS 일반 알림은 FCM을 경유하여 APNs로 전달된다.
- **iOS 전화 착신:** APNs **VoIP Push**와 앱의 **PushKit/CallKit**을 사용한다. 일반 FCM으로 대체하지 않는다.
- **Android 전화 착신:** 시간 제한이 있는 **FCM 고우선순위 데이터 메시지**와 앱의 OS 통화 UI 연동을 사용한다.
- **서버의 진실 원천(source of truth):** PostgreSQL의 통화 상태. 푸시 발송/소켓 이벤트/LiveKit 접속 성공을 혼동하지 않는다.
- **기존 코드 우선:** Express 5 + `pg` + BE2 기존 테이블·경로·응답 계약을 보존하고, 새 기능은 별도 모듈·추가 migration으로 구현한다.
- **음성 파일·STT·AI:** BE3의 기존 미디어·전사·상담 기록 버전 파이프라인을 재사용한다. 중복 STT 엔진이나 별도 상담 원문 테이블을 만들지 않는다.

**요청 범위:** 공통 알림, 전화 발신·수신·수락·거절·취소·타임아웃, 대기 상태, WebSocket 시그널링, LiveKit 오디오 통화, 잠금/백그라운드 착신, 재연결, 녹음 동의와 BE3 녹음/STT/AI 연동, 인수 테스트를 포함한다. **기능 삭제 없이 기존 Phase 0~8을 Phase 1~4로 통합**한다.

**이번 범위에서 제외:** PSTN(실제 휴대전화 번호 발신), SIP 사업자 연동, 영상통화, 그룹 통화, 자동 녹취 강제, 통화 중 실시간 AI 대화, 신규 채팅 기능. 이는 상위 문서의 장래 계획을 부정하는 것이 아니라 **이번 백엔드 증분의 제외 범위**다.

### 0.1 근거와 상태 표시

- **[상위 명세]** 첨부된 v2.0 기능명세서에 명시된 요구.
- **[제공된 코드 검토]** 사용자가 전달한 현재 저장소 조사 결과. 이 문서 작성 과정에서 재검증하지 않음.
- **[설계 제안]** 이 문서에서 신규 결정안으로 제시하는 기술·테이블·API·수치.
- **[결정 필요]** 다른 팀 또는 제품/법무/운영 정책 없이는 확정할 수 없는 사항.
- **[BLOCKED]** 현재 제공된 구조로는 운영용 기능 완료 판정 불가.

### 0.2 상위 명세 연결

| 상위 기능 ID | 요구사항 | 본 문서 위치 |
|---|---|---|
| CAL-01~10 | 예약·가능 시간·수락·변경·중복·완료·기록 연결 | Phase 1, Phase 2, Phase 4 |
| CNS-01 | 상담 시작 10분 전 참여 버튼 활성화 | Phase 1, Phase 3 |
| CNS-02~04 | 통화 연결 상태·재연결·마이크 권한 | Phase 3, Phase 4 |
| CNS-06~07 | 상담 기록 연결·녹음 상태/중지 | Phase 4 |
| REC-03~06 | 음성 변환·화자 표시·복합 입력·수정 이력 | Phase 4 / BE3 |
| AI-01~08 | 요약·변화·근거·검토·오류 처리 | Phase 4 / 기존 분석 |
| NTF-01~08 | 역할별 알림·읽음·설정·접근권한·발송 시점 | Phase 2~4 |
| LINK-01~05, AUTH | 담당자·대상자·가족 연결 및 인증 | Phase 1 |

> 상위 명세의 앱 내 통화는 **2단계** 기능이고, 전화/영상통화는 예약·기록·AI 기반 기능 검증 이후 추가하도록 되어 있다. 이 문서의 **Phase 1~4는 백엔드 작업 패키지 이름**으로 상위 제품 단계 1·2와 동일한 분류가 아니다.

---

## 1. 기존 저장소 계약 — 변경 금지 및 호환 기준

다음은 **[제공된 코드 검토]** 내용이다. 코드/DB 원본을 직접 검증한 최종 사실로 표시하지 않는다.

| 영역 | 기존 조건·문제 | 설계 결정 |
|---|---|---|
| 런타임 | Node.js 22, TypeScript 7, Express 5, Zod 4, `pg`; ORM 없음 | 기존 조합 유지; ORM 신규 도입 불필요 |
| 신규 패키지 | Firebase, LiveKit, WebSocket, 작업 큐 라이브러리 없음 | 필요한 것만 점진적으로 추가, 도입 버전 기록 |
| 알림 테이블 | `migrations/drafts/0002_be2_consultations.sql`의 `notifications`에 `notification_id`, `kind`, `appointment_id`, `follow_up_id`, `person_id`, `event_id`, `read_at` 존재 | **같은 이름의 테이블을 새로 만들지 않음**; outbox·delivery·기기 등록 별도 추가 |
| 알림 의미 | 기존 `event_id`는 UNIQUE 아님, `read_at`은 읽음 시각 | `event_id`만으로 발송 멱등 보장하지 않음; 읽음/발송 구별 |
| API | 시연 알림 `/api/be2/notifications`; 전화 경로 역할 문서 `/api/calls/*` | 기존 경로 보존; `/api/v1/*` 전면 전환 금지 |
| 응답 | 성공 `{ data }`; 실패 `{ error: { code, message } }` | 새 API도 같은 Envelope 유지 |
| 예약 | `appointments.status`는 확정된 enum이 없는 문자열; 전화 상담 유형 필드 없음 | 실제 상태 규칙 확정·상담 유형 확장 후 통화 권한 검사 |
| 대상자 | 예약의 `person_id`는 **사용자 `user_id`가 아님** | `person_id → user_id` 매핑 없이 발신 대상 결정 금지 |
| 담당자 | `staff_id = user_id` 보장 없음 | BE1에서 인증 사용자와 담당자 식별자 관계 확정 |
| 관계 모델 | `persons`, 가족 연결, 담당자 배정 관련 테이블 미완성/부재 보고 | 필요한 매핑·권한을 BE1과 계약화; 임시 가정으로 운영하지 않음 |
| 인증 | 해당 브랜치 `src/app.ts`에 인증 미들웨어 없음, BE1 연동 BLOCKED | 실인증 API 완료 전 운영 통화 API 차단 |
| 네트워크 | 서버가 `127.0.0.1`에 바인딩됨 | 실제 모바일·웹훅 시험용 HTTPS/WSS 환경 별도 필요 |
| 상담 원문 | `counseling_records`가 아니라 `consultation_record_versions` | 신규 상담 원문 테이블 생성 금지 |
| BE3 | `media_assets`, `transcripts`, 상태 `queued/running/succeeded/failed` | 기존 BE3 저장 및 작업 상태 재사용 |
| 웹훅 파서 | `src/app.ts`의 전역 `express.json()` | LiveKit 웹훅 raw body 수신 경로를 파서보다 먼저 등록 |

**검증 규칙:** migration 초안이 존재하는 것과 해당 migration이 현재 DB에 **실제 적용된 것**은 별개다. Phase 1에서 `schema_migrations` 또는 실제 테이블 조회로 확인한다.

---

## 2. 4개 Phase — 통합 개발 로드맵

| Phase | 통합되는 기존 단계 | 작업 패키지 | 핵심 완료 조건 |
|---|---|---|---|
| **Phase 1** | 기존 0 + 1 | 코드·DB 계약 동결, BE1 인증, ID 매핑, 예약의 통화 적격성 정의 | **인증된 발신자·수신자와 유효한 전화 상담 예약을 서버에서 정확히 검증** |
| **Phase 2** | 기존 2 + 3 | FCM 일반 알림, 기기 토큰, 알림 API, Outbox/Worker, 예약·후속·AI 이벤트 | **업무 이벤트 → 내 알림 저장 → 실제 기기 일반 푸시와 오류 처리를 검증** |
| **Phase 3** | 기존 4 + 5 + 6 | Signaling 상태 머신, REST/WebSocket, LiveKit WebRTC, APNs VoIP/Android 착신 | **A 발신 → B 잠금/백그라운드 착신 → 수락 → 양방향 음성 → 종료 검증** |
| **Phase 4** | 기존 7 + 8 | 동의·녹음 Egress → BE3 STT/AI 연동, 보안·실기기 E2E·운영 게이트 | **녹음·전사·검토 및 전체 1→4 흐름 PASS, 장애·권한 테스트 PASS** |

**게이트와 병렬화 원칙**

1. Phase 1 계약을 확정해야 Phase 3 **운영용** 통화 참가 권한을 발급할 수 있다.
2. Phase 1 인증 연동이 지연되어도 Phase 2 FCM·Outbox, Phase 3 상태 머신·LiveKit의 **격리된 개발 테스트**는 병렬 구현 가능하다.
3. 임시 계정·가짜 매핑·모의 푸시는 `TEST ONLY`로 표기하고 배포 환경에서는 비활성화한다.
4. Phase별 완료는 **코드 구현**, **격리 테스트**, **실기기 통합 테스트**를 구분해 기록한다. 일부 항목의 미완료를 전체 PASS로 바꾸지 않는다.
5. Phase 4가 전체 인수 게이트이며, Phase 1~3에서 누락된 실기기·보안 검증을 이때 완료한다.

---

# Phase 1. 기존 계약 정비 + 인증·수신자·예약 기반

## P1-A. 목표 및 비범위

**목표:** 기존 BE2를 유지하면서 통화와 일반 알림의 정확한 **사용자, 대상자, 예약, 권한** 관계를 확보한다. **BE1 인증 미연동·대상자 매핑 부재는 배포 차단 조건**이다.

**이 Phase에서는:** 푸시 공급자·LiveKit 실통화 자체를 구현 완료로 판정하지 않는다.

## P1-B. 상세 작업

| ID | 작업 | 구현·검증 내용 | 산출물 |
|---|---|---|---|
| P1-01 | 실제 스키마 확인 | `migrations/drafts`와 적용된 PostgreSQL 테이블·제약 비교 | `docs/audits/current-schema.md` |
| P1-02 | 기존 라우팅 조사 | `src/app.ts`, 미들웨어, 에러 Envelope, BE2 경로 조사 | `docs/contracts/existing-api.md` |
| P1-03 | BE1 인증 계약 | JWT/세션 검증, 역할·활성 상태, 사용자 식별자, 서비스 간 신뢰 경계 합의 | `docs/contracts/be1-auth.md` |
| P1-04 | 담당자 매핑 | 인증 `user_id ↔ staff_id` 변환 및 승인 상태 검사 | Identity Resolver 규격 |
| P1-05 | 대상자 매핑 | `person_id ↔ user_id`의 유효 연결, 복수 계정/가족 정책 분리 | Recipient Resolver 규격 |
| P1-06 | 배정 관계 | 해당 담당자가 그 대상자·예약에 접근 가능한지 서버 검사 | Authorization Matrix |
| P1-07 | 예약 상태 계약 | 실제 문자열 상태와 확정·취소·완료 상태, 허용 전이 정의 | Appointment Status Contract |
| P1-08 | 상담 종류 확장 | 기존 `appointments`에 전화 유형 식별 방식 추가(호환 migration) | DB Migration Draft |
| P1-09 | 시간 검증 | 시작 10분 전 참여 가능; 종료·지각·연장 정책 별도 결정 | Call Eligibility 규격 |
| P1-10 | BE3 입력 계약 | 미디어 파일 전달, 기존 STT 상태, 상담 기록 버전 ID 확인 | `docs/contracts/be3-media.md` |
| P1-11 | 테스트 기준 | 기존 예약/기록 동작 회귀 테스트, 가짜/실제 ID 구별 | P1 Test Report |

### P1-C. Identity/Eligibility 계약

`person_id`와 `user_id`, `staff_id`는 서로 다른 개념으로 유지한다. 서버는 **클라이언트가 제공한 `callee_user_id`를 신뢰하지 않고** 예약과 관계 데이터로 수신 계정을 산출한다.

```ts
// 설계 인터페이스 예시. 현재 코드에 존재한다는 의미가 아님.
interface CallEligibility {
  appointmentId: string;
  callerUserId: string;
  calleeUserId: string;
  personId: string;
  staffId: string;
  consultationType: 'PHONE';
  startsAt: string; // UTC ISO 8601
  endsAt: string;
  authorized: boolean;
}
```

**참여 허용 검사**

1. 서버가 인증된 사용자 ID·역할을 확인한다.
2. 해당 예약의 실제 담당자와 대상자 관계를 확인한다.
3. 대상자 계정(수신 가능 계정)이 존재하는지 확인한다.
4. 담당자 승인 및 배정 상태를 확인한다.
5. 예약 상태가 통화 가능한 확정 상태인지 검사한다.
6. 상담 유형이 `PHONE`인지 확인한다.
7. 서버 시간으로 시작 10분 전 이후인지 검사한다.
8. 취소·종료된 예약 또는 이미 점유된 통화인지 검사한다.

**미확정 정책:** 통화 참여 가능 종료 시점, 담당자의 역방향 호출, 가족의 대리 수락, 복수 담당자/가족 연결, 전화 대상자 본인 확인 방식. 미확정 시 기존 명세에 없는 권한을 임의로 부여하지 않는다.

### P1-D. DB·API 변경 지침

- 기존 `appointments.status`를 조사 없이 ENUM으로 변경하지 않는다.
- `consultation_type`(명칭 제안)는 기존 데이터와 호환되도록 단계적 migration으로 추가한다. 기본값·NULL 처리·백필 규칙은 현재 데이터를 조사한 후 정한다.
- 인증/수신자 관계는 **BE1이 소유하는 계약**을 우선하며, BE2가 관리하는 복제/캐시가 필요하면 소유자·유효기간·권한 회수를 합의한다.
- 기존 `{ data }`, `{ error: { code, message } }` Envelope와 `/api/be2/*`, `/api/calls/*` 관례를 유지한다.
- BE3의 `consultation_record_versions`에 대한 변경은 BE3 담당 승인 없이는 수행하지 않는다.

### P1-E. 필수 테스트

- [ ] 실제 적용 스키마와 migration 초안 차이 확인.
- [ ] 인증 없는 요청 차단.
- [ ] `person_id`를 `user_id`로 오인하지 않음.
- [ ] `staff_id`를 `user_id`와 동일하다고 가정하지 않음.
- [ ] 배정되지 않은 담당자의 접근 차단.
- [ ] 확정되지 않은 예약·전화 유형이 아닌 예약 차단.
- [ ] 시작 10분 전보다 이른 발신/입장 차단.
- [ ] 가족 연결 해제 후 해당 권한 차단(가족 기능 도입 시).
- [ ] 기존 BE2 API 응답·알림 조회·예약 기능 회귀 테스트.

**Phase 1 완료 게이트:** 실인증 주체와 예약 참여자를 정확히 식별하고, 유효한 전화 예약에서만 수신자를 계산할 수 있어야 한다. 인증·매핑이 막혀 있다면 **`PASS WITH BLOCKERS`** 또는 `BLOCKED`로 명시한다.

---

# Phase 2. 공통 푸시 알림 + Outbox/Worker + 업무 이벤트

## P2-A. 목표

기존 `notifications`를 보존하며 일반 알림 기능을 전체 서비스에 적용한다. Firebase는 **메시지 전달 공급자**일 뿐 CareGap 사용자 인증·업무 DB를 대체하지 않는다.

## P2-B. 세부 기능 요구사항

| ID | 기능 | 서버 책임 |
|---|---|---|
| N-BE-01 | 기기 등록 | 인증 사용자·앱 설치 식별자·플랫폼 등록 |
| N-BE-02 | 토큰 등록/갱신 | FCM 일반 토큰과 APNs VoIP 토큰을 별도 Channel로 관리 |
| N-BE-03 | 토큰 비활성화 | 로그아웃, 계정 변경, 공급자 무효 응답 처리 |
| N-BE-04 | 알림 생성 | 업무 이벤트별 실제 수신자 계산 후 기존 알림 모델에 기록 |
| N-BE-05 | 알림 조회/읽음 | 기존 `/api/be2/notifications`와 `read_at` 의미 보존 |
| N-BE-06 | 수신 설정 | 유형별 허용 상태, 필수 알림 정책은 별도 결정 |
| N-BE-07 | 알림 발송 | FCM 공급자 요청, 발송 결과/오류 별도 저장 |
| N-BE-08 | Outbox | 업무 변경과 알림 발송 의도 같은 트랜잭션 저장 |
| N-BE-09 | Worker | 폴링, 잠금, 중복 방지, 재시도, 고착 작업 정리 |
| N-BE-10 | 일정 알림 | 발송 직전 예약 변경·취소·관계 해제 여부 재검사 |
| N-BE-11 | 접근 통제 | 권한 없는 알림·딥링크 차단 |
| N-BE-12 | 운영 상태 | 공급자 접수 ≠ 사용자 단말 수신, 실패 원인 추적 |

### P2-C. DB 확장안

**기존 `notifications`는 재정의·중복 생성하지 않는다.** 기존 컬럼과 접근 경로를 변경할 때는 BE2 소유자와 호환성 검증이 필수다.

| 신규 테이블 | 최소 필드·제약(제안) | 목적 |
|---|---|---|
| `device_installations` | `id`, `user_id`, `installation_id`, `platform`, `last_seen_at`, `revoked_at`, `(user_id, installation_id)` 적절한 유일성 | 사용자-설치 연결 |
| `device_push_tokens` | `id`, `installation_id`, `channel`, `environment`, `token_ciphertext`, `token_fingerprint`, `invalidated_at`, `updated_at` | FCM/APNs 토큰 구별·보호 |
| `notification_outbox` | `id`, `business_event_key`, `event_type`, `reference_id`, `payload`, `status`, `available_at`, `attempt_count`, `lease_until` | 발송 작업 및 재처리 |
| `notification_deliveries` | `id`, `outbox_id`, `recipient_user_id`, `installation_id`, `provider`, `status`, `attempt_count`, `provider_message_id`, `last_error_code`, `updated_at` | 기기별 발송 시도 |
| `notification_preferences` | `user_id`, `type`, `enabled`, `updated_at` | 수신 설정(기존 모델 조사 후 채택) |
| `notification_recipients` | 알림·수신 계정·읽음 정보 | 여러 수신자별 읽음 상태가 필요한 경우 **조건부** 채택 |

**주의:** 기존 `notifications.event_id`에 유일 제약을 추가하는 것으로 새 멱등성을 구현하지 않는다. 새 `business_event_key`와 수신 계정·설치 조합별 유일성 규칙을 별도로 정의한다. 실제 복합 unique key는 기존 알림 소유 관계를 확인한 후 확정한다.

### P2-D. 일반 알림 이벤트

| 이벤트(제안 코드) | 발생 원인 | 수신자 결정 원칙 |
|---|---|---|
| `RESERVATION_REQUESTED` | 새로운 상담 신청 | 대상 예약의 담당자/상대방 |
| `RESERVATION_ACCEPTED` | 예약 수락 | 요청한 사용자 |
| `RESERVATION_REJECTED` | 예약 거절 | 요청한 사용자 |
| `RESERVATION_CHANGED` | 변경 요청·확정 | 해당 상대방(상태 구별) |
| `RESERVATION_CANCELLED` | 취소 | 관련 참여자 |
| `CONSULTATION_REMINDER` | 상담 전 알림 | 여전히 유효한 참여 계정 |
| `CONSULTATION_COMPLETED` | 상담 결과 등록 | 공개 정책상 허용 대상자 |
| `ANALYSIS_COMPLETED` | AI 분석 성공 | 권한 있는 담당자 |
| `FOLLOW_UP_DUE` | 후속 기한 도래 | 업무 담당자 |
| `STAFF_APPROVED/REJECTED` | 관리자 승인·반려 | 신청 담당자 |
| `NEW_MESSAGE` | 채팅 메시지 | 채팅 도입 시 사용 |

가족에게 보내는 알림의 종류와 민감정보 공개 범위, 리마인더 발송 시각(1일 전·1시간 전 등)은 **[결정 필요]**다.

### P2-E. API 제안 — 기존 경로 보존

| Method | Path | 목적 |
|---|---|---|
| `POST` | `/api/devices/register` | 설치 등록 및 푸시 토큰 갱신 |
| `DELETE` | `/api/devices/:installationId` | 본인 설치 해제 |
| `GET` | `/api/be2/notifications` | **기존** 알림 목록, 호환 유지 |
| `PATCH` | `/api/be2/notifications/:notificationId/read` | 읽음 API가 없다면 제안; 기존 유무 먼저 조사 |
| `GET` | `/api/notification-preferences` | 유형별 설정 조회(제안) |
| `PATCH` | `/api/notification-preferences` | 유형별 설정 변경(제안) |

**API 소유·경로가 최종 확정되기 전**에 `/api/v1`로 이동시키거나 기존 응답을 교체하지 않는다. 일반 사용자에게 타인 대상 임의 푸시 발송 API를 제공하지 않는다.

### P2-F. 트랜잭션·Worker 흐름

```text
BE2 예약/상담/후속 업무의 상태 변경
  └─ DB 트랜잭션
      ├─ 업무 데이터 UPDATE/INSERT
      └─ notification_outbox INSERT (고유 업무 이벤트 키)
               └─ COMMIT
                   └─ Worker가 준비된 작업 선점
                       ├─ 최신 수신 권한·알림 설정 검사
                       ├─ 활성 기기·토큰 확인
                       ├─ 기존 알림 레코드/연관 정보 연결
                       ├─ FCM 발송 시도
                       └─ notification_deliveries에 결과 저장
```

- Worker는 `FOR UPDATE SKIP LOCKED` 등 PostgreSQL 잠금을 사용해 중복 선점을 방지한다.
- Worker 프로세스 종료로 `PROCESSING`이 고착되면 lease/재처리 정책으로 회수한다.
- 일시적 오류만 제한된 횟수로 지수 백오프 재시도한다. 무효 토큰은 비활성화한다.
- 외부 공급자의 접수 응답을 **단말 표시·사용자 열람 성공**으로 기록하지 않는다.
- 푸시 본문에 상담 원문, 건강 정보, 인증 토큰, 비밀키 등을 포함하지 않는다.
- 알림 클릭 후에도 서버가 예약·대상자·가족 연결 권한을 재검증한다.

### P2-G. 완료 게이트

- [ ] 기기 등록/갱신/해제 API의 인증·소유권 검사 통과.
- [ ] iOS와 Android에서 **일반 FCM 알림** 실제 기기 수신 확인(클라이언트가 준비된 경우).
- [ ] 예약 생성·수락·취소 이벤트 → Outbox → Worker → 대상 사용자 알림 테스트 통과.
- [ ] 동일 이벤트 재처리 시 논리적 알림이 중복 생성되지 않음.
- [ ] FCM 장애 시 예약 트랜잭션이 외부 호출 때문에 롤백되지 않음.
- [ ] 만료 토큰/로그아웃 계정/관계 해제에 대한 발송 차단.
- [ ] 기존 알림 목록 및 `read_at`의 의미 유지.
- [ ] 네이티브 앱 미완성 시 발송 단위 테스트는 PASS 가능하나 **실기기 수신 게이트는 BLOCKED**로 별도 기재.

---

# Phase 3. 전화 Signaling + LiveKit WebRTC + iOS/Android 착신

## P3-A. 목표

**A가 전화 걸기 → 서버가 RINGING 통화 세션 생성 → B에 착신 → B 수락/거절 → 수락 후 양측이 같은 LiveKit Room에 연결 → 종료/재연결**까지 한 Phase에서 구현한다.

- **별도 물리적 소켓 대기방이 필수는 아니다.** RINGING은 PostgreSQL의 논리적 상태다.
- A/B는 단일 소켓을 공유하지 않는다. 각자 WebSocket(통화 제어)과 WebRTC 연결(실제 음성)을 사용한다.
- LiveKit Room은 수락 이후 최초 입장하도록 하되, 생성 시점은 서버 SDK 동작과 테스트 결과에 따라 결정한다.

## P3-B. 전화 기능 요구사항

| ID | 기능 | 서버 책임 |
|---|---|---|
| C-BE-01 | 발신 | 인증·예약·상담 유형·시간·상대 계정 검사 |
| C-BE-02 | 세션 생성 | `call_id`/Room Name/만료·상태 버전 생성 |
| C-BE-03 | 중복 방지 | 예약당 유효 통화 중복 방지, 멱등키 보존 |
| C-BE-04 | 착신 디스패치 | 활성 기기별 WebSocket/APNs VoIP/FCM 경로 선택 |
| C-BE-05 | 수락/거절 | 원자적 상태 변경 및 권한 검사 |
| C-BE-06 | 발신 취소/시간 초과 | 늦은 수락 차단, 다른 기기 동기화 |
| C-BE-07 | LiveKit 입장 | 오디오 전용 최소 권한 토큰 발급 |
| C-BE-08 | ACTIVE 판정 | 양측 연결 확인, 미디어 연결/착신 성공 구분 |
| C-BE-09 | 통화 재연결 | 현재 서버 상태를 확인하고 재입장 가능 여부 결정 |
| C-BE-10 | 종료/정리 | 통화 종료·LiveKit 참여자 제거·Room 정리 |
| C-BE-11 | 모바일 수신 | iOS PushKit/CallKit, Android FCM/Telecom 계약 제공 |
| C-BE-12 | 감사 추적 | 발신·수락·거절·취소·만료·종료 행위 기록 |

## P3-C. DB 추가안

| 테이블 | 핵심 컬럼(제안) | 제약 |
|---|---|---|
| `call_sessions` | `id`, `appointment_id`, `caller_user_id`, `callee_user_id`, `room_name`, `status`, `state_version`, `expires_at`, `accepted_at`, `connected_at`, `ended_at`, `end_reason`, timestamps | 예약 1개에서 여러 과거 통화 시도 허용, **동시 유효 통화**만 제한 |
| `call_participants` | `id`, `call_id`, `user_id`, `installation_id`, `livekit_identity`, `joined_at`, `left_at` | 실제 접속한 사용자·기기 구분 |
| `call_events` | `id`, `call_id`, `event_type`, `actor_user_id`, `state_version`, `occurred_at`, `metadata` | 상태 이력·원인 추적, 민감정보 금지 |
| `call_command_idempotency` | `actor_user_id`, `idempotency_key`, `request_hash`, `call_id`, `response_snapshot` | 필요하면 발신·중요 명령 멱등 관리 |

이름은 제안이며 `appointments`와 FK 관계는 실제 migration·PK 명칭을 확인한 후 확정한다. 통화 상태와 예약 상태는 독립적으로 저장한다.

## P3-D. 상태 머신

| 상태 | 의미 | 허용되는 주요 다음 상태 |
|---|---|---|
| `REQUESTED` | 서버가 발신 요청을 접수 | `RINGING`, `FAILED`, `CANCELLED` |
| `RINGING` | 착신 전달 시도 중·응답 대기 | `ACCEPTED`, `REJECTED`, `CANCELLED`, `MISSED` |
| `ACCEPTED` | B가 서버에서 수락 성공 | `CONNECTING`, `CANCELLED`/`FAILED` (정책 확정) |
| `CONNECTING` | 양측 미디어 연결 진행 | `ACTIVE`, `FAILED`, `CANCELLED`/`ENDED` (정책 확정) |
| `ACTIVE` | 양측 통화 Room 연결 확인 | `RECONNECTING`, `ENDED`, `FAILED` |
| `RECONNECTING` | 일시적 미디어 재연결 | `ACTIVE`, `ENDED`, `FAILED` |
| `ENDED` | 정상 종료 | 종단 상태 |
| `REJECTED` | 거절 | 종단 상태 |
| `CANCELLED` | 발신 취소/연결 전 취소 | 종단 상태 |
| `MISSED` | 수락 전 만료 | 종단 상태 |
| `FAILED` | 연결 실패 | 종단 상태 |

**상태 적용 규칙**

1. 모든 명령은 인증·참여 권한·현재 상태·서버 시각을 검증한다.
2. 상태 전이는 트랜잭션의 조건부 UPDATE 또는 행 잠금으로 **단일 승자**를 확정한다.
3. 상태 전이가 성공하면 `state_version`을 증가시키고 `call_events`를 기록한다.
4. 이벤트 전달이 실패해도 상태는 DB에 남는다. 재접속 시 최신 상태 조회로 복구한다.
5. `RINGING`은 **벨이 실제로 울렸음을 보증하지 않는다**. 단말에서 착신이 표시되었다는 ACK를 별도 설계할 수 있으나 실제 수신 성공의 절대 증거가 되지는 않는다.
6. 이미 종료된 세션을 재사용하지 않고 다시 발신하면 새 `call_id`를 만든다.
7. 계정당 1개 진행 통화 제한, 링타임 30초, 재연결 제한 60초는 **[설계 제안·정책 결정 필요]**이며 환경변수로 구성한다.

## P3-E. API (기존 `/api/calls/*` 경로 유지)

| Method | Path | 목적 | 인증/권한 |
|---|---|---|---|
| `POST` | `/api/calls` | 예약 ID로 발신 | 발신 가능한 예약 당사자 |
| `GET` | `/api/calls/:callId` | 현재 상태 조회 | 통화 당사자 |
| `GET` | `/api/calls/active` | 내 활성 통화 조회 | 인증 사용자 |
| `POST` | `/api/calls/:callId/accept` | 수락 | 해당 수신자·정상 만료 |
| `POST` | `/api/calls/:callId/reject` | 거절 | 해당 수신자 |
| `POST` | `/api/calls/:callId/cancel` | 발신 취소 | 해당 발신자 |
| `POST` | `/api/calls/:callId/join-token` | LiveKit 토큰 | 수락된 유효 통화 참여자 |
| `POST` | `/api/calls/:callId/end` | 종료 | 참여자·허용 상태 |
| `POST` | `/api/webhooks/livekit` | 미디어 상태·Room 이벤트 | LiveKit 서명 인증 |

기존 성공 Envelope:

```json
{
  "data": {
    "call_id": "opaque-call-id",
    "appointment_id": "appointment-id",
    "status": "RINGING",
    "state_version": 1,
    "expires_at": "2026-10-30T03:00:30Z"
  }
}
```

오류 Envelope:

```json
{
  "error": {
    "code": "CALL_EXPIRED",
    "message": "응답 가능한 통화 요청이 아닙니다."
  }
}
```

**HTTP 상태와 오류 코드(제안):** `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 CALL_NOT_FOUND`(필요시 타인 자료 존재 은닉), `409 INVALID_CALL_STATE / CALL_ALREADY_HANDLED / CALL_BUSY`, `410 CALL_EXPIRED`(자료 존재 노출 위험이 있으면 404/409로 통일), `422 RESERVATION_NOT_CALLABLE`, `503 MEDIA_UNAVAILABLE`. 실제 공통 에러 규칙과 조율한다.

### P3-E-1. 발신·수락 상세 프로토콜

1. A → `POST /api/calls` (예약 ID, `Idempotency-Key`).
2. 서버 → BE1 인증 및 Phase 1의 Eligibility Resolver를 거쳐 `call_sessions(RINGING)` 생성.
3. 서버 → 알림 Dispatch가 B의 활성 기기에 착신 발송. A는 논리적 대기 상태.
4. B → `POST /api/calls/:id/accept`.
5. 서버 → `RINGING → ACCEPTED`를 원자적으로 수행하고 수락 기기 기록.
6. 서버 → A/B에 `call.accepted` 이벤트 전송, 실패 시 각 클라이언트가 REST 조회.
7. A/B → 각자의 `POST /api/calls/:id/join-token` 요청.
8. 서버 → 두 참여자에게 같은 `room_name`과 각자 고유한 짧은 수명의 LiveKit 토큰 발급.
9. A/B → LiveKit Room에 **각자의 WebRTC 연결**로 입장.
10. 서버 → 참가 및 연결 상태 확인 후 `ACTIVE`; 종료 시 DB와 미디어 리소스 정리.

**경쟁 상황:** B 수락과 A 취소, B의 두 기기 동시 수락, 링타임 만료와 수락의 경쟁은 SQL 조건부 변경으로 **최초 유효 처리 하나만 성공**하게 한다.

## P3-F. WebSocket 시그널링

- WebSocket 연결 시 BE1 인증 정보 확인. `user_id`를 클라이언트 이벤트 본문에서 임의 수용하지 않는다.
- 서버는 통화 참여자에게만 다음 이벤트를 발송한다:
  `call.incoming`, `call.ringing`, `call.accepted`, `call.rejected`, `call.cancelled`, `call.connecting`, `call.active`, `call.reconnecting`, `call.ended`, `call.missed`, `call.failed`.
- 이벤트에 `event_id`, `call_id`, `state_version`, `occurred_at`을 포함한다.
- 송신 이벤트는 **중복·지연·역순** 가능성을 전제로 한다. 클라이언트는 버전과 서버 상태 조회로 복구한다.
- 다른 사용자나 기관의 통화 이벤트는 구독·열람할 수 없어야 한다.

```json
{
  "schema_version": 1,
  "event_id": "opaque-event-id",
  "type": "call.accepted",
  "call_id": "opaque-call-id",
  "state_version": 3,
  "occurred_at": "2026-10-30T03:00:05Z",
  "data": { "status": "ACCEPTED" }
}
```

## P3-G. LiveKit 권한 및 Webhook

- 참여 JWT는 서버에서만 서명한다. Secret을 앱에 전달하지 않는다.
- Room 입장 권한은 **지정된 Room과 특정 참여자만** 허용한다.
- `canPublishSources`는 `microphone`만 허용하고, 이에 필요한 `canPublish`/`canSubscribe`를 명시적으로 설정한다.
- 일반 참여 토큰에 Room 관리자·Room 녹음 권한(`roomAdmin`, `roomRecord`)을 부여하지 않는다.
- 녹음은 Phase 4에서 서버 권한으로 Egress를 제어한다.
- 참여 토큰의 짧은 TTL(초안: 300초)은 **새로 입장할 수 있는 시간**이며 연결된 통화의 자동 종료 타이머가 아니다.
- `participant_joined`, `participant_left`, `room_finished` 등 수신 가능한 이벤트를 실제 서버 SDK 기준으로 확인하고 중복·지연 처리한다.
- Webhook 서명은 **파싱 전 raw body**로 검증한다. 예시 Express 라우트는 아래와 같이 **전역 `express.json()` 이전**에 등록한다.

```ts
app.post('/api/webhooks/livekit',
  express.raw({ type: 'application/webhook+json' }),
  livekitWebhookHandler);
app.use(express.json());
```

> 코드는 **구조 예시**다. 실제 Handler의 raw payload 전달 방식과 SDK 서명 검증은 구현 시 버전에 맞춰 테스트해야 한다.

- 서버가 `ACTIVE`라고 표시해도 실제 청취 품질·마이크 권한·출력 장치까지 자동 보장하는 것은 아니다.
- 재연결, 종료, 강제 퇴장 정책은 LiveKit Cloud/자체 호스팅의 토큰 폐기 동작 차이를 고려해 설계한다.

## P3-H. 모바일 착신 전송 계약

| 항목 | iOS | Android |
|---|---|---|
| 일반 알림 | FCM → APNs | FCM |
| **전화 착신** | **APNs VoIP Push** (PushKit 토큰) | **FCM high priority** (FCM 토큰) |
| 앱 측 처리 | PushKit 수신 후 CallKit 착신 보고 | FCM 수신 후 알림/Telecom 통합 |
| 공통 payload | `call_id`, 불투명 통화 UUID, 만료 시각, 안전한 표시 정보 | 같은 논리 필드 |
| 서버 필수 검사 | 발송 시 유효 세션인지 확인, 수락 시 재검사 | 발송 시 유효 세션인지 확인, 수락 시 재검사 |
| 만료 | APNs expiration을 0 또는 짧은 값으로 설정 | TTL을 **남은 링타임 이하**로 설정 |

**iOS:** VoIP 토큰과 일반 FCM 토큰은 별개다. VoIP Push는 실제 착신에만 사용하며, iOS의 CallKit 보고 요구를 준수해야 한다.

**Android:** FCM 기본 보관 기간을 수신 대기 시간으로 사용하면 안 된다. 예를 들어 30초 링타임이면 메시지의 TTL을 **남은** 대기 시간에 맞춘다. 단, FCM 접수는 단말 수신을 보장하지 않는다.

**공통 실패:** 네트워크 차단·알림 권한·절전 정책·앱 강제 종료 등의 조건에서 푸시 기반 깨우기는 **보장할 수 없다**. 정확한 동작은 OS 버전 및 실제 단말 시험이 필요하다. 웹앱/PWA만으로 네이티브 전화 착신 UX 동등성을 약속하지 않는다.

## P3-I. 배포·네트워크 요구

제공된 현재 서버는 `127.0.0.1`에서만 수신하므로 실제 폰·LiveKit Cloud에서 접근할 수 없다. 시험 환경에 다음을 마련한다.

- HTTPS 외부 API 주소와 WSS 통신 경로.
- Webhook 수신 가능한 HTTPS 엔드포인트 및 인증/서명 검증.
- 개발·운영별 FCM·APNs·LiveKit 자격 증명 분리.
- 로컬/시연/통합 환경별 테스트 계정·데이터 격리.
- TLS·프록시·방화벽·오류 관측 설계.

**주의:** `0.0.0.0` 바인딩만으로 보안·접근성이 완성되는 것은 아니다.

### P3-J. 완료 게이트

- [ ] 두 클라이언트의 `발신 → RINGING → 수락/거절/취소/만료` 상태 테스트 통과.
- [ ] 수락·취소·만료·다중 기기 경쟁 상태에서 결과 하나만 확정.
- [ ] 인증·배정 관계·예약 유형/시각 검증 통과.
- [ ] 서로 다른 iOS/Android 또는 독립 시험 기기에서 LiveKit 양방향 오디오 확인.
- [ ] Webhook raw body 서명·중복·역순 처리 테스트 통과.
- [ ] 앱 포그라운드/백그라운드/잠금에서 플랫폼별 착신 시험.
- [ ] 만료된 수신 푸시로 통화 연결 불가.
- [ ] WebSocket 단절 후 서버 상태 복구, 통화 종료 후 Room 정리.
- [ ] 프론트/실기기 미준비 항목은 별도 **BLOCKED**로 판정하고 코어 로직 PASS로 전체 Phase를 대체하지 않음.

---

# Phase 4. BE3 녹음·STT·AI 연계 + 통합·운영 검증

## P4-A. 목표

통화와 상담 기록을 연결하고, 참여자 동의가 있는 녹음을 서버에서 시작·중단한다. 녹음 파일은 **기존 BE3 파이프라인**으로 전달한다. 이후 Phase 1~3 전체 흐름을 실제 기기·인증·네트워크 장애까지 통합 검증한다.

## P4-B. BE3와의 책임 경계

| 기능 | 담당 소유자 | 원칙 |
|---|---|---|
| 녹음·AI 동의 검증 | Call Service + 정책 담당 | 동의 전 녹음 강행 금지 |
| LiveKit Egress 시작/중단 | Call/Recording Adapter | 서버 API 키 사용, 일반 참여 토큰 사용 금지 |
| 녹음 완료 이벤트·파일 위치 | Recording Adapter | 원본 보존 및 비공개 저장 |
| 미디어 등록·파일 상태 | **BE3 `media_assets`** | 기존 계약 재사용 |
| STT·화자 구분 | **BE3 `transcripts`** | 기존 잡 상태 재사용 |
| 작업 상태 | **`queued / running / succeeded / failed`** | 중복 상태 체계 생성 금지 |
| 상담 기록·수정 이력 | **`consultation_record_versions`** | 원문/교정/AI 결과 구분 |
| AI 분석·근거·검토 | 기존 AI/BE3 파이프라인 | 승인되지 않은 결과를 확정 사실로 취급 금지 |

## P4-C. 녹음 정책 및 상태

**[상위 명세]** 녹음·AI 분석을 안내하고 동의 상태를 확인하며, 녹음 중임을 표시하고 중지할 수 있어야 한다. 거절·철회·녹음 실패 시 상담 진행·대체 기록 방식은 미확정이다.

- 양쪽의 녹음 동의 확인을 **초기 안전 기본안**으로 제안한다. 동의 수집의 적법성·운영 범위는 별도 법률/기관 정책 검토가 필요하다.
- 녹음 동의와 AI 분석 동의는 목적·정책 버전·철회 이력을 구분한다.
- 동의 철회 시 녹음 중지 요청과 실제 Egress 중단 확인을 기록한다.
- 통화 정상 종료와 녹음 성공, STT 성공, AI 성공은 별개 결과다.
- 녹음 파일 저장·보존 기간·파기·가족 열람 범위는 **[결정 필요]**다.
- 녹음이 불가능한 경우 상담을 계속할지/담당자 수기 기록으로 대체할지 정책 결정이 필요하다.

**DB(제안):** `call_consents` (`call_id`, `user_id`, `consent_type`, `policy_version`, `granted_at`, `revoked_at`) 및 `call_recordings` (`call_id`, `egress_id`, `storage_object_id`, `recording_status`, timestamps, `error_code`). 실제 원본 미디어·전사 정보는 BE3 데이터 모델에 남긴다.

## P4-D. 연동 데이터 흐름

```text
전화 통화 ACTIVE
  └─ 참여자 녹음/분석 동의 확인
      └─ LiveKit Egress (서버 API)
          └─ 비공개 Object Storage에 원본 저장
              └─ BE3 Media Ingestion (소유자 합의된 내부 API/이벤트)
                  ├─ media_assets
                  ├─ transcripts: queued → running → succeeded/failed
                  └─ consultation_record_versions (원문·교정본 버전)
                      └─ 기존 AI 분석 → 근거 검증 → 담당자 검토/승인
```

- BE3 호출 계약(기존 endpoint/입력 필드/파일 URI/소유권)은 **직접 확인 후** 확정한다. 이 명세가 새로운 BE3 API 경로를 임의로 확정하는 것은 아니다.
- STT/OCR·AI 실패를 성공으로 표시하지 않으며, 실패해도 기존 상담과 원본 파일을 임의 삭제하지 않는다.
- 파일 ID, 전사 원문 버전, 담당자 교정 버전, AI 근거가 참조한 원본 버전을 연동해야 한다.
- 분석 API에 불필요한 개인정보·비밀키를 전송하지 않는다.

## P4-E. 전체 인수 테스트

### 인증·예약·권한

- [ ] 실제 BE1 인증으로 상담사 A / 대상자 B 로그인.
- [ ] `staff_id`/`person_id`/`user_id` 매핑 일치.
- [ ] 확정된 `PHONE` 예약에 대해 10분 전 서버 입장 조건 검증.
- [ ] 배정되지 않은 담당자, 승인 전 계정, 타 사용자 요청 차단.
- [ ] 가족 연결 해제 후 접근 차단(해당 기능 출시 시).

### 일반 알림

- [ ] iOS·Android 일반 FCM 수신.
- [ ] 예약 변경/취소 시 오래된 리마인더 발송 중단.
- [ ] 로그인 변경·로그아웃 후 다른 계정의 알림 수신 방지.
- [ ] 알림 읽음·목록·권한 재검증.
- [ ] FCM 장애·중복 이벤트·Worker 재시작 시 데이터 정합성.

### 통화·미디어

- [ ] A 발신 → B 착신 → B 수락 → Room 연결 → 음성 → 종료.
- [ ] iOS 잠금/백그라운드 VoIP Push/CallKit 수신.
- [ ] Android 잠금/백그라운드 FCM 수신 및 적법한 통화 UI 처리.
- [ ] B 거절, A 취소, 링타임 만료, 뒤늦은 푸시 수락 거부.
- [ ] B 다중 기기 동시 수락 중복 차단.
- [ ] 마이크 권한 거부·음소거·오디오 미출력 오류 표시.
- [ ] Wi-Fi ↔ 이동통신 전환, WebSocket 끊김, LiveKit 재연결, 실패 후 정리.
- [ ] LiveKit Webhook 서명 오류·중복·지연·미수신 대비.
- [ ] 서버 재시작 후 고착 통화 및 Room 정합성 복구.

### 녹음·전사·분석

- [ ] 동의 전 녹음 시작 차단 및 녹음 상태 표시.
- [ ] 동의 철회/녹음 중지 후 Egress 중단 확인.
- [ ] 녹음 파일을 BE3 `media_assets`에 올바르게 연결.
- [ ] BE3 STT `queued/running/succeeded/failed` 상태 유지.
- [ ] STT 실패·업로드 실패 시 원본/상담 기록 보존.
- [ ] 교정본·원문 버전·분석 근거 연결.
- [ ] 담당자 검토·승인 없이 AI 결과를 확정 정보로 공개하지 않음.

### 운영·보안

- [ ] Firebase/APNs/LiveKit 키와 토큰이 로그·오류·Git에 포함되지 않음.
- [ ] WSS/HTTPS 통신 및 Webhook 접근 제어.
- [ ] 알림·통화 API의 과도한 요청 및 중복 발신 방지.
- [ ] 기관·역할·상담 권한 회수 테스트.
- [ ] 실제 트래픽 기준 부하·지연·동시 통화 한계 측정(정량 목표는 별도 결정).
- [ ] DB migration 적용·되돌리기 계획 및 기존 BE2 회귀 테스트.

### P4-F. 최종 판정 기준

| 판정 | 의미 |
|---|---|
| `PASS` | 코드·DB·API·실기기·권한·실패·BE3 연동 게이트 모두 충족 |
| `PASS WITH WARNINGS` | 핵심 흐름 성공, 비차단 경고가 문서화됨. 운영 준비 완료와 동일하지 않음 |
| `BLOCKED` | BE1·BE3·모바일 앱·외부 인프라·정책 등의 의존성이 미충족 |
| `FAIL` | 구현 오류 또는 보안·권한·무결성 인수 기준 미충족 |

실제 사용자·기관 데이터로 운영하기 전 개인정보 처리, 동의, 저장·파기, 가족 공개 범위, 관리자 접근, 외부 서비스 이전·위탁 등의 정책과 법률을 별도로 검토한다.

---

## 3. 팀 간 인터페이스·책임 분담

| 영역 | 백엔드 담당 | 프론트/모바일 담당 | 의존 계약 |
|---|---|---|---|
| 로그인·권한 | BE1 토큰 검증/역할/사용자 ID | 로그인·토큰 전달 | BE1 Auth Contract |
| 예약·수신자 | BE2 예약/담당 관계/수신자 Resolve | 예약·발신 버튼 | Appointment/Identity Contract |
| 일반 알림 | FCM Admin, Outbox, Worker, 알림 조회 | FCM/APNs 앱 토큰 취득, 클릭/표시 | Push Payload v1 |
| iOS 착신 | APNs VoIP 서명·전송·만료 | PushKit/CallKit | Incoming Call Payload v1 |
| Android 착신 | FCM high priority·TTL | FCM 수신·통화 UI/Telecom | Incoming Call Payload v1 |
| 통화 제어 | `/api/calls/*`, DB 상태, WebSocket 이벤트 | 발신/대기/수락/종료 UI | Call State / Event v1 |
| 오디오 | LiveKit Room·최소 권한 토큰·Webhook | LiveKit SDK, 마이크/스피커 제어 | RTC Token Contract |
| 녹음·STT | Egress와 BE3 전달 | 동의·녹음 상태 표시 | BE3 Media Contract |
| AI·검토 | BE3 및 기존 AI 작업 | 결과·근거·검토 UI | 기존 분석 계약 |

**공통 전달 산출물(필수)**

1. OpenAPI 또는 정확한 요청/응답 예시가 포함된 REST Contract.
2. WebSocket Event Schema(버전, 이벤트·상태 코드, 필드, 재동기화 방법).
3. 통화 상태 전이표와 허용/거부 케이스.
4. 일반 푸시/VoIP Push payload 및 만료 정책.
5. 사용자·대상자·담당자 매핑과 권한표.
6. BE3 녹음 파일·STT·상담 기록 연동 계약.
7. 실기기 E2E 테스트 절차 및 결과.

---

## 4. PR/브랜치 전략 — 4개 통합 패키지

| PR | 브랜치 이름(제안) | 포함 범위 | 병합 게이트 |
|---|---|---|---|
| PR-1 | `feature/caregap-call-foundation` | Phase 1 계약·호환 migration·인증/수신자/예약 검증 | 기존 BE2 회귀 + identity 게이트 |
| PR-2 | `feature/caregap-push-notifications` | Phase 2 기기·FCM·Outbox·Worker·알림 이벤트 | 일반 푸시 + 장애·멱등 테스트 |
| PR-3 | `feature/caregap-webrtc-calls` | Phase 3 상태 머신·WebSocket·LiveKit·APNs VoIP/Android FCM | 정상/실패 통화 + 모바일 착신 시험 |
| PR-4 | `feature/caregap-calls-be3-integration` | Phase 4 녹음·BE3 통합·전체 E2E·운영 | BE3 계약 + 보안 + 종합 검증 |

브랜치는 현재 존재하는 사실이 아닌 **제안된 명칭**이다. 이전 BE2 PR과의 베이스·커밋·충돌 여부는 작업 직전 확인한다. 팀 환경에서는 하나의 대형 PR에 기능을 과도하게 묶지 않도록 **각 Phase 내부 커밋**을 기능 단위로 분리한다. 필요하면 리뷰용 하위 PR로 나누되 외부 관리 단계는 4개로 유지한다.

---

## 5. 환경변수 및 비밀정보(예시)

```dotenv
# Existing environment
DATABASE_URL=

# Firebase General Push (실제 형식은 배포 플랫폼의 Secret 설정 정책 따름)
FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_JSON=

# Apple VoIP Push
APNS_TEAM_ID=
APNS_KEY_ID=
APNS_BUNDLE_ID=
APNS_AUTH_KEY=
APNS_ENVIRONMENT=development

# LiveKit
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# Proposed configurable policy, NOT production-approved values
CALL_RING_TIMEOUT_SECONDS=30
CALL_RECONNECT_TIMEOUT_SECONDS=60
CALL_JOIN_TOKEN_TTL_SECONDS=300

NOTIFICATION_WORKER_ENABLED=false
```

- `FIREBASE_SERVICE_ACCOUNT_JSON`, `APNS_AUTH_KEY`, `LIVEKIT_API_SECRET`를 저장소에 커밋하지 않는다.
- 개발·시연·운영 환경의 키, 푸시 토큰 및 LiveKit 배포 대상을 분리한다.
- 실시간 호출/비동기 발송의 오류를 구조화해 기록하되 개인정보·오디오 원문·토큰은 제외한다.
- 실제 API 엔드포인트 주소, 키 배치 방식, 정확한 라이브러리 버전은 Phase 1의 구현 환경 분석 후 결정한다.

---

## 6. 남아 있는 제품·팀 의사결정

| 항목 | 현재 상태 | 해결 주체/시점 |
|---|---|---|
| `person_id ↔ user_id`, `staff_id ↔ user_id` | **BLOCKED** | BE1·BE2 / Phase 1 |
| 담당자-대상자 연결·배정·복수 사용자 | **결정 필요** | BE1·서비스 정책 / Phase 1 |
| 예약 상태 코드 및 전화 상담 유형 | **BLOCKED** | BE2 / Phase 1 |
| 발신 종료 허용 시각 | **결정 필요** | 제품/BE2 / Phase 1 |
| 가족의 전화 수락·알림 범위 | **결정 필요** | 제품/권한 정책 / Phase 1~2 |
| 알림 예약 전송 시각 및 필수 알림 | **결정 필요** | 제품/운영 / Phase 2 |
| 통화 수신 대기·재연결 시간 | **제안값만 존재** | 제품/개발 / Phase 3 |
| 통화 중복·복수 기기 정책 | **1계정 1통화 초기안** | 제품/개발 / Phase 3 |
| LiveKit Cloud vs 자체 호스팅 | **결정 필요** | 인프라·개발 / Phase 3 |
| HTTPS/WSS 접근 가능한 개발 환경 | **BLOCKED** | 인프라 / Phase 3 |
| 녹음 거부/철회 시 상담 진행 방식 | **결정 필요** | 제품/법무 / Phase 4 |
| 녹음 저장 기간·삭제·가족 열람 | **결정 필요** | 제품/법무/보안 / Phase 4 |
| BE3 실제 Ingestion API/이벤트 계약 | **직접 확인 필요** | BE3 / Phase 1·4 |
| Android/iOS 앱 기술 및 권한 구현 | **프론트 협의** | 모바일 팀 / Phase 3 |

---

## 7. 최종 인수 시연 시나리오

1. BE1 인증으로 **담당자 A**와 **대상자 B** 로그인.
2. BE2에서 두 계정의 관계가 확인된 **전화 상담 예약** 확정.
3. 예약 또는 상담 이벤트로 일반 푸시 알림 수신.
4. 시작 허용 시각에 A가 `/api/calls`로 발신.
5. 서버가 `RINGING`으로 통화 세션 저장, B에 OS별 착신 전달.
6. B의 휴대전화가 **백그라운드/잠금**인 상태에서 수신 UI 표시.
7. B가 수락하면 서버에서 원자적으로 `ACCEPTED`.
8. A/B는 각자 LiveKit 토큰을 발급받고 같은 Room에서 실제 양방향 오디오 연결.
9. 네트워크 변경·재연결 후 정상 복구하거나 명시적인 실패 상태 처리.
10. 통화 종료 후 서버 상태는 `ENDED`, 미디어 Room 리소스 정리.
11. 동의된 통화는 서버 Egress로 녹음하고 BE3의 `media_assets`, `transcripts`로 전달.
12. BE3 STT·검토본을 상담 기록 버전에 연결하고 기존 AI 분석·담당자 검토로 이어짐.
13. 동일 요청 재전송, 중복 Webhook, 늦은 푸시, 권한 해제, 동의 철회, STT 실패를 재현해 결과 기록.

**최종 PASS 정의:** 위 시나리오의 정상·예외 경로와 기존 BE2 회귀 테스트가 모두 통과하고, 실기기 결과·보안/권한·BE3 연동 증거를 확인해야 한다. 문서 작성만으로는 완료가 아니다.

---

## 8. 참조와 변경 관리

### 8.1 참조한 정보

1. 사용자 첨부 `CareGap_Final_Functional_Spec_v2.0(1).pdf` (21쪽, 2026-10-29): 서비스 단계, 계정·연결, 예약, CNS/REC/AI/NTF 요구사항, 운영 전 미결정 정책.
2. 사용자 제공 **현재 저장소 검토 요약**: Express 5/`pg` 기존 스택, 알림 테이블/경로·응답 계약, BE1·BE2·BE3 상태 및 기술적 차단 요소. **현재 저장소의 독립적 실행·확인 결과는 아니다.**
3. 앞선 대화에서 합의한 **9단계 → 4단계 통합 방향**: `기존 0+1 → 통합 1`, `2+3 → 2`, `4+5+6 → 3`, `7+8 → 4`.

### 8.2 변경 통제

- 상위 문서의 **확정 요구사항**과 이 문서의 **제안 기술·수치**를 혼동하지 않는다.
- 기존 BE2 스키마나 공개 API의 의미를 변경할 경우 migration, 호환 계획, 데이터 백필, 회귀 테스트를 같이 제출한다.
- BE1/BE3 소유 데이터·API는 해당 담당자의 승인 없이 임의 정의·대체하지 않는다.
- PR마다 `Implementation Status`, `Tests Executed`, `Evidence`, `Known Blockers`, `Rollback Plan`을 명시한다.
- 미검증 항목을 PASS로 선언하거나, 모의 데이터 통과를 실제 iOS/Android 통화 검증으로 표시하지 않는다.

**문서 끝 — Draft v1.0**
