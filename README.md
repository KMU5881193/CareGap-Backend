# CareGap Backend
Node.js 22.15+ ESM · TypeScript 7.0.2 · Express 5 · Zod 4 · pg/SQL.

1. pnpm install --frozen-lockfile
2. .env.example을 .env로 복사하고 사용할 로컬 포트를 PORT에 직접 지정
3. pnpm dev (127.0.0.1의 지정한 PORT에서 실행). PORT 미지정/빈 값/잘못된 값이면 안내 오류로 종료
4. 로컬 Docker가 있을 때만 POSTGRES_HOST_PORT에 사용할 로컬 DB 포트를 지정하고 docker compose up -d. DATABASE_URL을 같은 포트와 caregap_local DB에 맞춘 뒤 pnpm migrate. `migrations/drafts/`의 BE2 SQL은 적용되지 않는다. 설계는 docs/be2-schema.md를 본다.

완전히 새로 시작하는 CareGap 프로젝트입니다. 기존 Next.js CareGap·caregap-camera-poc은 아이디어와 요구사항 참고 자료이며 코드·설정의 복사 기반이 아닙니다.
백엔드와 프론트엔드의 팀 표준 포트는 아직 미정이며 기본 숫자를 지정하지 않습니다. Docker 내부 5432는 PostgreSQL 이미지의 기본 포트이고 팀 서버 포트가 아닙니다.
앱 테스트는 Supertest가 임시 포트를 할당하므로 PORT 없이 실행합니다. CI 역시 고정 서버 포트 없이 검사합니다.

pnpm typecheck / pnpm test / pnpm build. Docker 실행은 선택이며 /health는 DB 연결 검사가 아닙니다.
공유 서버·공용 DB·Supabase 변경 금지. 실제 개인정보/토큰/녹음은 커밋 금지.
BE1/BE2 업무 구현은 담당자에게 남겨 둡니다. docs/contracts.md 및 docs/openapi.yaml 참고.
main은 공통 초기 환경, feature/ai-foundation은 BE3 작업용. 각 담당자는 feature/auth-*, feature/appointments-*, feature/ai-* 브랜치 및 PR 리뷰 사용.

초대 없이 참여하는 Fork/PR 절차와 직접 Push 권한의 차이는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 출처·포트 감사표는 [docs/initialization-audit.md](docs/initialization-audit.md)에 있습니다.
