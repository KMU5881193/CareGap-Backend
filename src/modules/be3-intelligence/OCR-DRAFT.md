# BE3 OCR Foundation — 리뷰용 계약 초안

이 문서는 BE3 내부 구현 제안이며 팀 확정 API가 아니다. 기존 공통 계약·OpenAPI·서버·PORT·BE1/BE2 모듈은 수정하지 않았다. 실제 서버에 라우터를 마운트하지 않는다.

## 구현 범위와 파일

- `ocr-image.ts`: Zod 입력 검증, JPEG/PNG 시그니처·MIME·확장자 일치 검사, 전체 디코딩 및 메타데이터 제거.
- `ocr.ts`: 기존 OcrProvider/Actor/Id/AuthorizationPort 재사용, 주입형 OCR 서비스·저장소, Mock, 버전 충돌 검사, 확정본 전달.
- `ocr-router.ts`: BE1 세션 해석 함수를 요구하는 독립 Express 라우터. 테스트 헤더를 해석하지 않는다.
- `tests/ocr.test.ts`: 합성 이미지·합성 문장만 사용한 Vitest/Supertest 검증.

추가 의존성 sharp 0.34.5: 기존 의존성에는 이미지 디코더가 없어, 시그니처만 정상인 손상 파일을 검출하려고 사용한다. 잠금 파일과 sharp에 한정한 pnpm allowBuilds 승인을 함께 관리한다. 원본 이미지를 저장하거나 외부 OCR로 보내지 않는다. 디코딩 후 재인코딩한 바이트만 제공자에 전달한다. 사용자 파일명은 검증에만 쓰며 경로·저장명으로 사용하지 않는다.

## 상태와 데이터

`pending → processing → succeeded | failed`. 서비스는 생성 시 pending 스냅샷을 반환하고 프로세스 내부에서 처리한다. 조회 시 이미 processing/succeeded일 수 있다. 수정·확정은 succeeded에서만 허용한다. failed는 오류 코드와 retryable 힌트만 반환하며 제공자 예외 메시지는 노출하지 않는다. 자동 재시도·재실행 API는 없다. 오류를 해결한 뒤 새 request_key로 작업을 만드는 방식만 테스트한다.

작업에는 UUID id/person_id/created_by, UTC created_at, status, provider_kind, version, corrections가 있다. provider_kind=mock은 사전 작성한 합성 문장을 반환한다는 표시다. injected는 주입된 어댑터라는 뜻이며 실제 엔진 여부를 보증하지 않는다. Mock은 사진 속 글씨를 읽지 않는다.

성공 시 original은 처음 검증한 OCR 텍스트이며 교정으로 덮어쓰지 않는다. version은 교정 횟수(초기 0). corrections는 `{version,text,edited_by,edited_at}`의 누적 이력이다. 확정은 `{version,confirmed_by,confirmed_at}`. 원문을 그대로 승인할 때도 교정본 버전 1을 명시적으로 제출한다. 이번 초안에서는 확정 후 수정과 재확정을 거부한다. 재교정 정책은 팀 합의 전 미지원이다.

저장소는 인스턴스별 In-memory이며 조회·저장 시 복제한다. 동기 insert와 compare-and-swap으로 동일 요청 및 동시 수정 충돌을 방지한다. 대체 PostgreSQL 어댑터는 동일 동작을 트랜잭션·고유 제약·원자적 조건부 갱신으로 보장해야 한다. 이미지 바이트는 저장하지 않으며 처리 중 메모리에만 존재한다. 작업·교정본·중복 키는 재시작 시 사라지고, 현재 구현에는 TTL·메모리 할당량·삭제 스케줄이 없다. 운영용 저장소나 작업 큐가 아니다.

## HTTP 제안

마운트 제안: `/api/ocr` (현재 실제 서버에는 미마운트). 성공 `{data:...}`, 실패 `{error:{code,message}}`.

| Method | 경로 | 입력 | 성공 |
|---|---|---|---|
| POST | /api/ocr/jobs | person_id(UUID), request_key(1~128자), filename, mimeType, base64 | 202 작업 스냅샷 |
| GET | /api/ocr/jobs/:id | UUID | 200 작업 상태와 데이터 |
| GET | /api/ocr/jobs/:id/result | UUID | 200 성공 작업의 원문·교정 이력, 미성공이면 409 |
| POST | /api/ocr/jobs/:id/corrections | expected_version(현재 정수), text | 200 새 교정본을 포함한 작업 |
| POST | /api/ocr/jobs/:id/confirmation | expected_version(현재 양의 정수) | 200 확정 작업 |

생성 JSON 예: `{person_id:"UUID",request_key:"local-fixture-1",filename:"synthetic.png",mimeType:"image/png",base64:"..."}`. base64는 표준 패딩 형식이며 Data URL은 거부한다. 실제 HTTP에서는 유효한 JSON을 사용한다. 전송 형식은 테스트용 JSON/base64 제안이며 multipart는 구현하지 않았다.

Idempotency 범위는 actor.user_id + OCR 생성 + request_key. 같은 대상자·MIME·정규화 이미지이면 기존 작업을 반환하며 202를 유지한다. 같은 키에 다른 입력은 409 CONFLICT. 파일명과 제거된 메타데이터는 중복 판정에서 제외한다. 다른 대상자에 대한 권한 검사도 먼저 실행한다. 키 보존 기간은 운영 정책 미정이다.

오류 코드:

- 400: INVALID_REQUEST, INVALID_ID, INVALID_IMAGE, EMPTY_IMAGE, INVALID_SIGNATURE, MIME_MISMATCH, EXTENSION_MISMATCH, CORRUPT_IMAGE
- 401: UNAUTHENTICATED
- 403: FORBIDDEN (권한 검사기 예외도 fail closed)
- 404: NOT_FOUND
- 409: CONFLICT, RESULT_NOT_READY, NOT_CONFIRMED(서비스 전달 경계)
- 413: IMAGE_TOO_LARGE
- 500: INTERNAL_ERROR (내부 상세 비공개)
- 작업 실패 데이터: PROVIDER_FAILED / PROVIDER_TIMEOUT(retryable=true), INVALID_PROVIDER_RESULT(retryable=false)

초기 로컬 제한은 이미지 5 MiB, 디코딩 16,000,000 픽셀, 라우터 JSON 7 MiB, 제공자 5초, 텍스트 100,000자다. 모두 운영 정책 확정값이 아니다. 서비스의 이미지 제한과 타임아웃은 주입 가능하다. WebP/HEIC는 향후 검토 후보이며 현재 거부한다. 제공자 타임아웃은 대기를 끝내지만 OcrProvider에 취소 계약이 없어 실행 자체를 중단하지 않는다. 외부 엔진을 연결하기 전 취소·리소스 격리·작업자·동시 처리 제한을 검토해야 한다.

## BE1 / BE2 / FE 협의

BE1은 검증된 세션 기반 resolveActor와 현재 관계·배정·동의·철회 상태를 반영하는 AuthorizationPort를 제공해야 한다. 생성/교정/확정은 write, 조회는 read, 확정본 전달은 analyze로 검사한다. role 자체로 권한을 부여하지 않으며 가족·관리자 자동 접근도 없다. 서비스 직접 호출에도 actor/권한 검증을 적용한다. 매 요청마다 검사하며 이전 성공을 권한 캐시로 사용하지 않는다. 권한 없는 기존 ID는 403, 미존재 ID는 404로 구분하므로 운영 연결 전 존재 여부 은닉 정책도 합의한다.

BE2 전달 계약 제안은 `confirmedInput(actor,id)`의 `{ocr_job_id,ocr_version,person_id,text}`. BE2가 현재 상담 연결 권한을 확인하고 공식 consultation_id/record_version_id를 생성한 뒤, OCR 출처 ID/교정 버전을 함께 보관하는 방식이다. 전달 함수는 자체적으로 공식 기록을 생성하지 않는다. 이 반환값은 SourceVersion이 아니므로 validateDraft에 곧바로 넣지 않는다. 실제 AI 입력은 BE2의 권한 확인된 불변 RecordVersion을 통해서만 구성한다. 자동 AI 실행은 없다.

FE는 status를 폴링하고 failed.failure를 표시하며, provider_kind=mock 표시를 유지한다. 교정 시 최신 version을 expected_version으로 보내고 409면 다시 조회해 사용자가 충돌을 해결한다. original과 corrections는 분리 표시하고 명시적인 확정 행위를 제공한다.

운영 미결정: 인증/동의/철회, 보관·삭제·암호화, 동시 처리·rate limit, 재교정·재확정·재시도, 업로드 전송 방식, 감사 로그, 대상자/상담 연결, 중복 키 TTL. 이들이 준비되기 전 현재 구현을 운영에 노출하지 않는다.

## 다음 OCR 비교 실험

같은 합성 한국어 손글씨 상담지와 정답 텍스트를 고정하고, 인쇄체·흘림체·저조도·기울어짐을 나눈 평가 세트를 만든다. 기존 Tesseract를 기준선으로 두고 한국어 PaddleOCR 및 손글씨 특화 엔진 후보를 동일 이미지로 비교한다. 후보의 현재 지원 범위·라이선스·실행 환경은 실제 도입 단계에서 확인한다. 글자 오류율(CER), 단어 오류율(WER), 핵심 숫자/부정어 누락, 지연·메모리, 교정에 걸린 시간을 기록한다. 이름·주소 등 실제 개인정보는 사용하지 않는다. 이번 작업에서 모델 설치·정확도 측정·외부 API 호출은 수행하지 않았다.

## 최종 안전성 검토 보완 (2026-10-29)

- EXIF 방향을 제거하기 전에 회전·반전을 픽셀에 적용한다. PNG의 방향값 1~8 및 JPEG 회전을 합성 이미지로 검증한다.
- 큰 base64 입력에서 V8 정규식 스택 초과를 재현하여, 반복 그룹 정규식을 길이에 비례하는 문자 검사로 교체했다. JSON 7 MiB 제한과 디코딩 파일 5 MiB 제한을 각각 검증한다.
- OCR 제공자의 반환 텍스트는 앞뒤 공백·개행까지 그대로 보존한다. 공백뿐인 결과와 100,000자 초과 결과는 거부한다. 교정본은 별도로 공백 정리 및 버전을 적용한다.
- 제공자 예외는 고정 오류 코드로 변환한다. 제공자가 서비스 오류 객체를 던져도 상세 코드가 응답에 유출되지 않는다. 권한 어댑터의 반환값은 boolean true만 승인한다.
- 타임아웃 후 늦은 성공·실패가 와도 failed 상태가 유지된다. 서로 다른 작업의 역순 완료, 동일 버전 교정·확정 경합을 검증한다.
- 크기·픽셀 제한은 이미지별 제한이다. 프로세스 전체의 메모리 상한이나 동시 디코딩 개수 제한은 구현하지 않았다. sharp의 임시 버퍼·재인코딩 버퍼와 메타데이터 처리에도 메모리가 필요하므로 픽셀 수를 프로세스 메모리 상한으로 해석하면 안 된다.
- sharp 네이티브 모듈은 로컬 Windows에서 실행 검증한다. 잠금 파일에 Windows/Linux 플랫폼별 의존성이 있으며 Ubuntu 실행 호환성은 PR의 기존 GitHub CI로 확인한다. CI 설정 자체는 변경하지 않는다.
- 실제 OCR 엔진·외부 OCR API·운영 DB는 미연결이다. OCR 라우터는 실제 서버에 미마운트이며 BE1 실제 인증·관계 검사, BE2 공식 상담 기록 버전 연동을 기다린다. 경로·보관 정책·포트는 팀 확정 사항이 아니다.
