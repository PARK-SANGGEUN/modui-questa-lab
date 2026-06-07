export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const key = process.env.GEMINI_API_KEY;

  if (!key) return res.status(500).json({
    error: "GEMINI_API_KEY 환경변수가 없습니다. Vercel → Settings → Environment Variables를 확인하세요."
  });

  const { mode } = body;
  if (!["topics", "report"].includes(mode)) {
    return res.status(400).json({ error: `지원하지 않는 mode: ${mode}` });
  }

  // 2025년 6월 현재 사용 가능한 모델 목록 (순서대로 시도)
  const MODELS = [
    process.env.GEMINI_MODEL,
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
  ].filter(Boolean);

  /* ─── 프로필 ─── */
  const profile = [
    `목표 대학: ${body.level || "미선택"}`,
    `계열: ${body.track || ""}`,
    `세부학과: ${body.majorDetail || ""}`,
    `2022 과목: ${body.subject || ""}`,
    `관심 키워드: ${body.keyword || "없음"}`,
    `기존 활동/독서: ${body.history || "없음"}`,
    body.selectedCase ? `참고 합격사례: ${body.selectedCase}` : "",
    body.prevResearch  ? `이전 탐구 내용: ${body.prevResearch}` : "",
  ].filter(Boolean).join("\n");

  const RULES = `[절대 금지]
- "~를 탐구하는 맞춤 주제" 같은 템플릿 제목
- 5개 주제의 구조·질문·산출물 반복
- "~에 대한 탐구", "~를 통한 탐구" 형태 제목

[반드시]
- 주제명에 탐구 대상·변수·범위를 명확히 포함
- 2022 개정 교육과정 과목과 직접 연결
- 세부학과와 탐구의 연관성을 구체적으로 설명`;

  /* ─── PROMPTS ─── */
  let prompt = "", isJSON = false;

  if (mode === "topics") {
    isJSON = true;

    const routeNote = body.reportMode === "db"
      ? `\n★ 합격사례 DB 중심 경로: 학생이 선택한 합격사례 "${body.selectedCase || ""}"의 탐구 구조·방법을 참고해 유사하지만 완전히 새로운 주제를 설계하라.`
      : body.prevResearch
      ? `\n★ 기존 탐구 심화 경로: 학생의 이전 탐구 "${body.prevResearch}"를 바탕으로 심화·확장된 주제를 설계하라.`
      : "";

    prompt = `${RULES}

[학생 정보]
${profile}
${routeNote}

[목표 대학 "${body.level || "미선택"}"에 맞는 탐구 요구]
- 서울대/KAIST/POSTECH: 좁고 깊은 탐구, 오차 분석, 자기주도 심화
- SKY(연세·고려): 학업 수월성, 동기→과정→발견→결론 스토리
- 서강·성균관·한양: 전공적합성, 정량 데이터, 면접 연계
- 중앙·경희·외대·시립: 성장 스토리, 직접 수행 가능 방법
- 교대/사범대: 교직 인성, 교육 문제 해결
- 지방거점국립대: 지역사회 문제 연계, 전공 기초소양
- 의약학: 생명윤리 필수, 임상적 문제의식
- 예체능: 포트폴리오, 실기+이론, 작품 기획·비평

위 학생 정보와 목표 대학 수준에 맞는 탐구 주제 5개를 추천하라.
각 주제는 탐구방법·질문방향·산출물이 완전히 달라야 한다.
로드맵 6단계 이상, 각 단계에 실제 행동·도구·산출물·수정 흔적 포함.

반드시 아래 JSON만 출력 (마크다운·코드블록 절대 금지):
{
  "topics": [
    {
      "type": "탐구유형(데이터분석형/실험설계형/비교문헌형/정책분석형/창작비평형/모델링형 — 5개 모두 달라야 함)",
      "title": "구체적 제목(탐구 대상·변수·범위 포함)",
      "question": "핵심 탐구 질문",
      "summary": "탐구 방법·예상 산출물 포함 3~4문장",
      "majorFit": "세부학과 적합 이유 2~3문장",
      "curriculumFit": "2022 개정 과목 연결 (과목명 직접 언급)",
      "sourceCase": "유사 합격사례 구조 설명",
      "duplicateCheck": "다른 4개 주제와 겹치지 않는 이유",
      "differentiator": "차별화 포인트 한 줄",
      "tags": ["태그1","태그2","태그3"],
      "evidence": {
        "subject": "교과 근거",
        "book": "도서/자료 추천",
        "admission": "목표 대학 평가 관점"
      },
      "roadmap": [
        {
          "title": "단계명",
          "detail": "실제 행동·도구·산출물·수정과정 포함 3~5문장",
          "tools": ["도구1","방법2","자료3"]
        }
      ]
    }
  ]
}`;

  } else if (mode === "report") {
    const isDB = body.reportMode === "db";
    const sourceNote = isDB
      ? `★ 경로A — 합격사례 DB 기반: 선택 합격사례 구조를 참고해 학생 맞춤 보고서 작성.`
      : `★ 경로B — 기존 탐구 심화: 학생 이전 탐구("${body.prevResearch||""}")를 바탕으로 심화 보고서 작성.`;

    prompt = `${RULES}

[학생 정보]
${profile}

[선택 주제]
${JSON.stringify(body.selectedTopic || {}, null, 2)}

${sourceNote}

완성형 탐구 보고서 초안을 작성하라. 출력하면 바로 참고 가능한 수준으로.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
탐 구 보 고 서
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▌탐구 주제

▌탐구 기간 (예: 20XX년 X월 ~ X월, 총 X주)

▌탐구 동기 (교과 수업에서 출발한 자연스러운 흐름 3~4문장)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 질문의 진화
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
① 처음 질문:
② 심화 질문 1:
③ 심화 질문 2:
④ 최종 탐구 질문:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 이론적 배경 및 2022 개정 과목 연결
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(핵심 개념 2~3가지, 교과서 단원명 직접 언급)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 참고 자료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(실존 가능한 도서/논문/공공데이터 3~4개)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 탐구 설계
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 탐구 방법:
• 독립변수:
• 종속변수:
• 통제변수:
• 데이터 수집 방법:
• 예상 산출물:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 예비 탐구 및 수정 과정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(실패 경험과 재설계 포함)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 본 탐구 과정 (6단계)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1단계:
2단계:
3단계:
4단계:
5단계:
6단계:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. 결과 및 해석
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(구체적 수치·패턴·비교 포함)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. 한계점 및 후속 탐구
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 한계점:
• 후속 탐구 방향:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. 세부학과 연결 및 진로 의미
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[학생부 세특 기재 예시 — 교사 시점, 500자 내외]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[면접 핵심 답변 소재 3가지]
①
②
③`;
  }

  /* ─── Gemini 호출 (여러 모델 순차 시도) ─── */
  async function callGemini(model) {
    try {
      const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: mode === "topics" ? 0.88 : 0.70,
          topP: 0.92,
          maxOutputTokens: mode === "topics" ? 8192 : 6144,
        },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data?.error?.message || `HTTP ${r.status}`;
        return { error: msg, modelTried: model };
      }
      const cand = data?.candidates?.[0];
      const text = (cand?.content?.parts || []).map(p => p.text || "").join("\n").trim();
      if (!text) return { error: "응답이 비어 있음", modelTried: model };
      return { text, sources: extractSources(cand?.groundingMetadata), modelUsed: model };
    } catch (e) {
      return { error: e.message, modelTried: model };
    }
  }

  /* 모델 순차 시도 */
  let result = null;
  const errors = [];
  for (const model of MODELS) {
    result = await callGemini(model);
    if (!result.error) break;
    errors.push(`[${model}] ${result.error}`);
  }

  if (result.error) {
    return res.status(500).json({
      error: `모든 모델 시도 실패.\n${errors.join("\n")}\n\nVercel 환경변수 GEMINI_API_KEY를 확인하세요.`
    });
  }

  /* ─── 응답 처리 ─── */
  if (!isJSON) {
    const k = mode === "report" ? "report" : "text";
    return res.status(200).json({ [k]: result.text, sources: result.sources, modelUsed: result.modelUsed });
  }

  try {
    const parsed = parseJSON(result.text);
    const topics = dedupe(parsed.topics || []);
    if (topics.length < 1) {
      return res.status(500).json({ error: "주제를 생성하지 못했습니다. 다시 시도해 주세요.\n\nRaw: " + result.text.slice(0, 300) });
    }
    return res.status(200).json({ topics: topics.slice(0, 5), sources: result.sources, modelUsed: result.modelUsed });
  } catch (e) {
    return res.status(500).json({ error: `JSON 파싱 실패: ${e.message}\n\nRaw: ${result.text.slice(0, 500)}` });
  }
}

/* ─── 유틸 ─── */
function parseJSON(text) {
  const clean = String(text).replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); } catch (_) {}
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(clean.slice(s, e + 1)); } catch (_) {}
  }
  throw new Error("유효한 JSON을 찾지 못했습니다.");
}
function tokens(s) {
  return new Set(String(s || "").replace(/[^\w가-힣\s]/g, " ").split(/\s+/).filter(x => x.length > 1));
}
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / (new Set([...A, ...B]).size || 1);
}
function isTemplate(t) {
  const title = String(t.title || "");
  return /맞춤\s*주제$/.test(title) || /에\s*대한\s*탐구$/.test(title) || /을\s*통한\s*탐구$/.test(title);
}
function dedupe(list) {
  const out = [], types = new Set();
  for (const t of list) {
    if (!t?.title || !t?.question) continue;
    if (isTemplate(t)) continue;
    const key = `${t.title} ${t.question}`;
    if (out.some(o => similarity(key, `${o.title} ${o.question}`) > 0.32)) continue;
    if (types.has(t.type) && out.length < 4) t.type = t.type + " 심화형";
    types.add(t.type);
    out.push(t);
    if (out.length === 5) break;
  }
  return out;
}
function extractSources(meta) {
  return (meta?.groundingChunks || []).map(c => c.web).filter(Boolean)
    .map(w => ({ title: w.title || w.uri, uri: w.uri })).filter(x => x.uri);
}
