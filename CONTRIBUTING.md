# CareGap 협업 안내

백엔드 3명(BE1 인증·권한, BE2 상담·예약, BE3 파일·AI·복지 정보)과 프론트엔드 2명이 협업합니다. 이 저장소는 처음부터 새 기술 스택으로 작성하며 기존 Next.js CareGap·개인 PoC의 코드/설정을 그대로 이식하지 않습니다. 역할·API·DB·권한은 담당자와 합의하세요.

## 초대 없이 Fork와 PR로 참여

1. 열람만 하려면 `git clone https://github.com/KMU5881193/CareGap-Backend.git`으로 공개 원본을 Clone합니다.
2. 기여하려면 GitHub 원본 페이지의 **Fork**에서 본인 계정으로 Fork합니다.
3. 본인 Fork를 Clone하고 원본을 upstream으로 등록합니다. 아래 YOUR_LOGIN은 본인 GitHub 아이디로 바꾸세요.

```sh
git clone https://github.com/YOUR_LOGIN/CareGap-Backend.git
cd CareGap-Backend
git remote add upstream https://github.com/KMU5881193/CareGap-Backend.git
git fetch upstream
git switch -c feature/ai-your-task upstream/main
pnpm install --frozen-lockfile
```

4. 기능별 브랜치에서 작업하고 `pnpm typecheck`, `pnpm test`, `pnpm build`를 실행합니다. BE1은 feature/auth-*, BE2는 feature/appointments-*, BE3는 feature/ai-*를 권장합니다.
5. 변경한 파일만 선택해 커밋하고 본인 Fork로 Push합니다.

```sh
git add <변경한-파일>
git commit -m "변경 목적"
git push -u origin feature/ai-your-task
```

6. 본인 Fork의 **Compare & pull request**에서 원본 `KMU5881193/CareGap-Backend`의 `main`으로 PR을 제출합니다. 변경 이유·계약 영향·테스트 결과를 적으세요.
7. 저장소 관리자가 CI와 담당자 리뷰를 확인한 후 Merge합니다. 공통 계약·스키마 변경은 관련 담당자와 합의합니다. BE3 전용 기존 작업은 `feature/ai-foundation`에 있으므로 해당 작업을 이어받을 때는 먼저 베이스와 PR 대상을 관리자와 맞추세요.

Public은 누구나 읽고 Fork/PR할 수 있다는 의미입니다. 원본 저장소에 누구나 직접 Push할 수 있는 것은 아닙니다. 직접 Push가 필요하면 저장소 관리자가 Settings → Collaborators에서 해당 GitHub 계정을 초대하고, 팀원이 수락해야 합니다. 이 설정 작업에서는 초대나 직접 Push 권한 부여를 하지 않았습니다.

## 설정과 정보 보호

- 서버 포트는 미정입니다. 실행할 때 본인 `.env`에 PORT를 지정하세요. 테스트는 고정 서버 포트 없이 실행합니다.
- `.env`, API 키, 토큰, 운영 DB 비밀번호, 실제 상담 자료·녹음·개인정보를 커밋하지 마세요. 예시 값과 합성 fixture만 사용합니다.
- Git 작성자 이름·이메일은 공개 커밋 메타데이터입니다. 처음 커밋하기 전에 `git config user.name`과 `git config user.email`을 확인하고 필요하면 GitHub noreply 이메일을 로컬 저장소에 설정하세요. 이미 공개된 과거 기록은 설정을 바꿔도 없어지지 않습니다.
- 본인 계정 권한의 Fork/브랜치에서 작업하세요. 원본 main 직접 수정, 강제 Push, 기록 재작성, 공용 DB·서버 변경은 별도 합의 없이 하지 않습니다.
- 비밀정보가 커밋되면 파일만 삭제하지 말고 즉시 관리자에게 알리고 해당 자격증명을 폐기/교체하세요. 공개 전 발견되면 공개를 중단합니다. 히스토리 정리는 별도 승인이 필요합니다.
