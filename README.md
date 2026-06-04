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


## UI/출력 개선
- 화면에서 Google/Gemini/API 문구를 내부 사례 DB 기반 문구로 정리
- 생성 진행률 표시
- 예상 소요시간 표시
- 단계별 진행 상태 표시
- 앱 화면 하이라이트 스타일 추가
- 보고서 출력물 테두리선 강화


## DB 분리·확장
- `/db/univCases.json`: 1,730개 사례 구조 DB
- `/db/subjects2022.json`: 2022 개정 과목·개념·탐구 스타일 DB
- `/db/majors.json`: 계열별 세부학과 DB
- `/db/methods.json`: 탐구방법·산출물·단계 DB
- `/db/books.json`: 도서·자료 관점 DB
- `/db/univLevels.json`: 대학급 평가 관점 DB

## 구조 변경
- 기존 `index.html` 내부 대형 DB를 외부 JSON으로 분리
- 생성 요청 시 현재 선택값과 매칭되는 DB 사례를 서버로 전달
- 화면 DB 카운트 자동 표시
