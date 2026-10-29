BE3 담당 영역. 역할 문서와 docs/contracts.md를 기준으로 구현합니다. 공통 계약 변경은 담당자 리뷰가 필요합니다.

feature/ai-foundation: AI 초안 스키마, 불변 기록 버전/원문 인용 검증, OCR/STT/분석 provider 인터페이스만 포함합니다.
OCR Foundation: 이미지 입력 검증, Mock OCR, In-memory 작업 저장소, 교정·확정·버전 관리 및 독립 라우터를 구현했습니다. 세부 API와 협업 경계는 [OCR-DRAFT.md](./OCR-DRAFT.md)의 리뷰용 초안을 확인하세요.
실제 OCR 엔진·외부 서비스·운영 DB·영속 작업 큐·실제 AI 실행·공개 API는 미연결이며, OCR 라우터는 실제 서버에 마운트하지 않았습니다. BE1 실제 인증·관계 검사와 BE2 공식 기록 버전 연동은 대기 상태입니다.
권한·동의 검사를 통과한 자료만 validateDraft에 전달해야 하며, 인용 일치는 분석 내용의 타당성이나 진단을 보증하지 않습니다.
