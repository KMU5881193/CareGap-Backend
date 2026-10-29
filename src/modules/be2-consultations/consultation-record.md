# BE2 상담 기록 버전 초안

이 문서는 순수 도메인 함수의 범위다. 라우트, DB, 인증 미들웨어가 아니다. 공통 계약은 `docs/contracts.md`와 `src/shared/contracts.ts`의 `RecordVersion`, `RecordReader`가 우선한다.

스키마와 함수는 `consultation-record.ts`에 있다. 공통 인터페이스는 바꾸지 않았다.

## 기록의 필드

한 버전은 `consultation_id`, `record_version_id`, `person_id`, `text`다. 알 수 없는 필드는 거절한다. UUID 대소문자는 유지하고, 같은지 비교할 때만 대소문자를 무시한다.

`text`는 공통 계약과 같이 문자열인지만 본다. 빈 문자열을 허용하는 업무 규칙으로 확정하지 않았고, 길이 상한도 두지 않았다.

## 버전

기존 버전 객체는 수정하지 않는다. 수정본은 새 `record_version_id`와 새 `text`를 가진 별도 버전이다. 상담과 대상자 식별자는 원본 버전에서 복사한다. 수정 입력으로 상담이나 대상자를 바꾸지 못한다.

같은 `record_version_id`는 다시 쓰지 않는다. 그 식별자가 다른 `consultation_id`에 이미 있으면 연결 불일치다. 한 상담의 버전들은 같은 `person_id`만 가진다. 비교는 UUID 대소문자를 무시한다.

조회 키는 `consultation_id`와 `record_version_id`다. 배열 순서는 원본, 최신, 버전 번호가 아니다. 작성 시각, 수정자, 버전 번호, 생성 권한은 필드가 없다.

같은 버전 식별자가 컬렉션에 둘 이상이면 그중 하나를 고르지 않는다. 없는 버전, 다른 상담의 버전, 모호한 버전은 원문을 결과에 넣지 않는다. `consultation_mismatch`와 `ambiguous_version`은 원문 없이 사유만 구분한다. 그 구분을 외부 오류로 그대로 내보내면 버전 식별자의 존재 여부가 드러나므로, 공개 응답에서는 `not_found`와 같은 결과로 다루어야 한다.

`RecordReader`는 만든 시점의 버전만 복사해 둔다. 이후 입력 객체의 `text`를 바꾸거나, 반환된 객체의 `text`를 바꾸어도 다음 조회는 그 복사본을 반환한다.

## BE3

분석에 넘기는 원문은 `selectAnalysisSource`가 고른 한 버전이다. 반환 필드는 `consultation_id`, `record_version_id`, `text`이며 BE3 `SourceVersion`에 그대로 넘길 수 있다. 다른 상담의 버전이나 다른 `person_id`의 원문은 넘기지 않는다.

이 함수는 분석 결과를 기존 버전의 `text`에 쓰지 않는다. 원본, 교정본, AI 생성문, 검토본, 공개본을 구분하는 상태명은 없다.

`RecordReader.getVersion`은 공통 인터페이스 그대로다. 이 조회는 권한 확인이 아니다.

## 접근

역할만으로 원문을 반환하지 않는다. 가족 연결, 배정, 동의를 이 모듈이 판단하지 않는다.

호출자가 BE1 `AuthorizationPort.canAccess`를 이미 호출한 뒤에만 `{ verified: true, allowed }`를 넘긴다. 그 객체는 호출자가 만든 값이다. 이 모듈이 권한 검사를 실행했거나 검사가 끝났다는 증거가 아니다. `verified: false`와 `allowed: false`는 허용이 아니고, 원문을 포함하지 않는다. `role`은 접근 입력이 아니다. 이 모듈은 `AuthorizationPort`를 호출하지 않으며 미들웨어도 만들지 않는다. `RecordReader.getVersion`도 권한을 검사하지 않는다.

실패 사유와 검증 오류에는 상담 원문을 넣지 않는다.

## 미확정

- 본문 길이 상한과 빈 문자열의 업무 의미
- 버전 번호, 최신 버전 판정, 작성 시각, 수정자, 버전 생성 권한
- 원본·교정본·AI 생성문·검토본·공개본의 구분
- 기록 수정 후 재분석 여부

## BE1을 확인하기 전에는 정하지 않음

- 사용자 테이블 이름, PK 컬럼, 자료형
- 그 테이블 마이그레이션 파일명과 번호
- 인증·승인 미들웨어의 경로와 호출 방법

BE2 FK와 라우트 공개는 그 확인 이후다. 마이그레이션 파일명 규칙 `NNNN_beN_description.sql`은 유지한다.
