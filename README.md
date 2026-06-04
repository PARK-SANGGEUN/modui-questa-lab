# QUESTA OS 수정본

## 수정 내용
- `/api/analyze.js` 생성: Vercel API 경로 정상화
- Gemini JSON 오류 자동 보정
- `response_mime_type=application/json` 적용
- Google Search 실패 시 검색 없이 재시도
- response_mime_type 미지원 시 일반 생성으로 재시도
- 탐구성향/학생수준 선택 제거
- 템플릿 제목 필터 유지

## Vercel 환경변수
- GEMINI_API_KEY 필수
- GEMINI_MODEL 선택. 기본값: gemini-1.5-flash
