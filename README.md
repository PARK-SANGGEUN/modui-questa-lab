# 모두의 QUESTA LAB

고1·고2·고3 학생 상담용 탐구 주제 생성 및 탐구 보고서 설계 플랫폼입니다.

## 배포
1. GitHub 저장소 이름 추천: `modui-questa-lab`
2. `index.html`, `api/analyze.js`, `package.json` 업로드
3. Vercel에서 GitHub 저장소 Import
4. Settings → Environment Variables에 `OPENAI_API_KEY` 추가
5. Deploy

## 구조
- 프론트 화면: `index.html`
- GPT 연결 서버리스 함수: `api/analyze.js`
- API Key는 브라우저에 노출되지 않습니다.
