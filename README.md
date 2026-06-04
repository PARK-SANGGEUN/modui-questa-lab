# QUESTA OS 모델 오류 수정본

## 핵심 수정
- `gemini-1.5-flash is not found` 오류 해결
- 단일 모델 고정 제거
- 모델 자동 재시도 순서:
  1. GEMINI_MODEL 환경변수 값
  2. gemini-2.0-flash
  3. gemini-2.5-flash
  4. gemini-2.5-flash-lite
  5. gemini-1.5-flash-latest
  6. gemini-1.5-pro-latest
- Google Search 실패 시 검색 없이 재시도
- JSON 오류 자동 보정
- `/api/analyze.js` Vercel 경로 포함

## Vercel 환경변수
필수:
- GEMINI_API_KEY

선택:
- GEMINI_MODEL

권장:
- GEMINI_MODEL을 아예 비워두면 자동 모델 재시도가 작동합니다.
- 기존에 `gemini-1.5-flash`로 넣어두었다면 삭제하거나 `gemini-2.0-flash`로 바꾸세요.
