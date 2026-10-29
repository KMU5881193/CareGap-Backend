# 초기 설정 감사 및 정정 — 2026-10-29

## 읽기 전용 감사 기준
원격 fetch 후 확인한 main: 4187704. BE3 원격 브랜치 feature/ai-foundation: 951c836. 감사 시작 시 추가 커밋·PR·로컬 미커밋 변경 없음.

A: 이번 새 프로젝트를 위해 작성한 스캐폴딩·설정·테스트·문서와 설치 도구 생성물(pnpm-lock.yaml). 근거는 이전 작업의 파일 작성/설치 도구 실행 기록과 해당 루트 커밋. Git 루트 커밋만으로 출처를 증명한 것은 아님.
B: 기존 Next.js CareGap에서 그대로 복사됐다고 확인된 파일 없음.
C: caregap-camera-poc에서 그대로 복사됐다고 확인된 파일 없음.
D: 현재 추적 파일 중 출처 불명으로 분류한 파일 없음. 외부 원본 프로젝트 전체와 바이트 비교를 수행한 감사는 아니며, 이전 생성 작업 기록에 근거함.
R: 업로드된 역할 참고 문서. A/B/C/D와 구별되는 알려진 외부 참고 자료. 기존 프로젝트 구현 코드가 아님.
E: 포트 가정은 출처 분류와 별개로 아래 기록.

## 역할 문서 출처
docs/CareGap_Backend_3_Roles.md는 사용자가 업로드한 파일을 이전 작업에서 Copy-Item한 자료. 현재 업로드 임시 원본과 SHA-256 일치: AC9F659F67A5DE511B4E8CA9B32D945EA2245B06ADD8F13C6028A39F9F3DB07F. 참고 문서로 유지하고 운영 확정 명세로 취급하지 않음.

## 감사 시작 당시 전체 main 파일 분류

| 파일 | 분류 |
|---|---|
| .env.example | A |
| .github/workflows/ci.yml | A |
| .gitignore | A |
| .npmrc | A |
| .nvmrc | A |
| README.md | A |
| compose.yaml | A |
| docs/CareGap_Backend_3_Roles.md | R |
| docs/contracts.md | A |
| docs/openapi.yaml | A |
| migrations/README.md | A |
| package.json | A |
| pnpm-lock.yaml | A |
| pnpm-workspace.yaml | A |
| scripts/migrate.ts | A |
| src/app.ts | A |
| src/config.ts | A |
| src/modules/be1-auth/README.md | A |
| src/modules/be2-consultations/README.md | A |
| src/modules/be3-intelligence/README.md | A |
| src/server.ts | A |
| src/shared/contracts.ts | A |
| tests/app.test.ts | A |
| tsconfig.check.json | A |
| tsconfig.json | A |

## BE3 브랜치 추가/수정 파일
모두 A: docs/validation.md, src/modules/be3-intelligence/README.md, src/modules/be3-intelligence/analysis.ts, tests/analysis.test.ts. 이전 apply_patch 및 커밋 951c836 기록으로 새 작성 확인. main에 강제로 병합하지 않고 별도 정정 PR에서 동일 포트 수정을 적용.

## E: 발견한 포트 가정과 정정
- src/config.ts:4 — PORT 기본값 3002 제거. 앱 구성과 실행 서버 구성을 분리하고 parseServerConfig에서 PORT 필수·범위 검증.
- .env.example:2 및 README.md:6 — 3002 예시/실행 가정 제거. PORT 빈 값 및 명시 설정 안내.
- compose.yaml:10, .env.example:3 — 호스트 DB 포트 54322 고정 제거. POSTGRES_HOST_PORT 명시 입력과 DATABASE_URL 수동 일치 안내.
- scripts/migrate.ts:12의 3002001은 PostgreSQL advisory lock 키이며 포트가 아님. 변경하지 않음. Docker 내부 5432는 이미지 기본 포트이고 팀 서버 포트와 무관.
- package.json 실행 스크립트, .github/workflows/ci.yml에는 고정 실행 포트 없음. Supertest는 임시 포트 사용.

## 제거/보존 및 검증
제거한 파일 없음. 신규 스캐폴딩, 도메인 경계, 공통 계약 초안, 역할 참고 문서와 마이그레이션 러너 보존. BE3 코드는 원래 브랜치에 보존. tests/config.test.ts 추가.
타입 검사, Vitest 17개(main 기반), 서버 빌드 PASS. BE3와 결합한 검증은 별도 PR 결과에 기재. Docker 실행 파일 미확인으로 Compose/DB 실행 미검증. 공용 DB 접속 없음.

## 보안 확인 범위 및 팀 합의
추적 파일과 초기 커밋의 검사에서 실제 운영 토큰/개인정보 유출은 확인되지 않음. Compose의 local-only는 로컬 DB용 공개 예시 비밀번호이며 운영 자격증명이 아님. 외부 전체 저장소/계정에 대한 비밀정보 전수 검사를 의미하지 않음.
팀 표준 포트, API·ID·권한 계약, DB 테이블, 운영 인증, 가족 공개/동의, 외부 AI·파일 저장소, 네이티브 기능은 담당자 합의 필요. 기존 원본 프로젝트/공유 서버/공용 DB/Supabase 변경 없음.
