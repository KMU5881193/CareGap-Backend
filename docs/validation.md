# 초기 환경 검증 — 2026-10-29

- Node.js 22.15.0, pnpm 11.25.0, TypeScript 7.0.2 실제 설치.
- main: 타입 검사(서버/마이그레이션/테스트 포함), Vitest 5개, 서버 빌드 PASS.
- feature/ai-foundation: 타입 검사, Vitest 11개(운영 개발 인증 차단 및 BE3 인용/버전 검증 포함), 서버 빌드 PASS.
- pnpm install --frozen-lockfile PASS. 잠금 파일 커밋.
- PostgreSQL/Docker/마이그레이션 실행은 Docker 실행 파일 미확인으로 미검증. 공유 DB 접속 없음.
- 실제 OCR/STT/AI 제공자·파일 저장소·인증/관계/예약·검토 공개 흐름 미구현.
- CI는 GitHub Actions에서 별도로 실행되며 로컬 PASS와 구분해야 합니다.
