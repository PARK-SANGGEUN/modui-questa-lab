export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY 환경변수가 없습니다. Vercel 환경변수를 확인하세요.',
    });
  }

  const body = req.body || {};
  const modelList = buildModelList(process.env.GEMINI_MODEL);
  const profileText = buildProfile(body);
  const dbCtx = buildDBContext(body.localDB || {});
  const SYSTEM = buildSystem();

  let prompt = '';
  let jsonMode = true;

  if (body.mode === 'topics') {
    prompt = buildTopicsPrompt(SYSTEM, profileText, dbCtx, body);
  } else if (body.mode === 'transform') {
    prompt = buildTransformPrompt(SYSTEM, profileText, dbCtx, body);
  } else if (body.mode === 'compare') {
    jsonMode = false;
    prompt = buildComparePrompt(SYSTEM, profileText, dbCtx, body.selectedTopic || {});
  } else if (body.mode === 'report') {
    jsonMode = false;
    prompt = buildReportPrompt(SYSTEM, profileText, dbCtx, body.selectedTopic || {}, body);
  } else {
    return res.status(400).json({ error: '지원하지 않는 mode: ' + body.mode });
  }

  try {
    let result = await callGeminiWithFallback({
      key,
      modelList,
      prompt,
      useSearch: false,
      mode: body.mode,
      jsonMode,
    });

    if (result.error && String(result.error).includes('response_mime_type')) {
      result = await callGeminiWithFallback({
        key,
        modelList,
        prompt,
        useSearch: false,
        mode: body.mode,
        jsonMode: false,
      });
    }

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    if (!jsonMode) {
      const k = body.mode === 'report' ? 'report' : 'text';
      return res.status(200).json({
        [k]: result.text,
        sources: result.sources || [],
        model: result.model,
      });
    }

    let parsed;

    try {
      parsed = parseJSON(result.text);
    } catch (e) {
      const rep = await repairJSON({
        key,
        modelList,
        badText: result.text,
      });

      if (rep.error) {
        return res.status(500).json({
          error: 'JSON 보정 실패: ' + rep.error,
        });
      }

      parsed = parseJSON(rep.text);
    }

    const topics = dedupe(parsed.topics || []);

    if (topics.length < 5) {
      return res.status(500).json({
        error: '주제가 5개 미만입니다. 다시 시도해 주세요.',
      });
    }

    return res.status(200).json({
      topics: topics.slice(0, 5),
      sources: result.sources || [],
      model: result.model,
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || '생성 중 오류가 발생했습니다.',
    });
  }
}

/* ── PROFILE ── */
function buildProfile(body) {
  return `대학급: ${body.level || '미선택'}
계열: ${body.track || '미선택'}
세부학과: ${body.majorDetail || '미선택'}
2022 과목군: ${body.subjectGroup || '미선택'}
2022 개정 과목: ${body.subject || '미선택'}
관심 키워드: ${body.keyword || '없음'}
현재 학년: ${body.currentGrade || '1'}
현재 학기: ${body.currentSemester || '1'}
기존 활동/독서: ${body.history || '없음'}`;
}

/* ── DB CONTEXT ── */
function buildDBContext(localDB) {
  const cases = (localDB.matchedCases || []).slice(0, 20);
  const books = (localDB.relatedBooks || []).slice(0, 6);
  const methods = localDB.methodPool || [];

  const caseLines = cases
    .map((c, i) => {
      const outputs = Array.isArray(c.outputs) ? c.outputs.join(', ') : '-';
      const focus = Array.isArray(c.focus) ? c.focus.join(' · ') : '-';
      const concepts = Array.isArray(c.concepts) ? c.concepts.join(', ') : '-';

      return `${i + 1}. [${c.level || ''}/${c.u || ''}/${c.m || ''}] 교과:${c.subject || '-'} 키워드:${c.k || '-'}
   주제: ${c.t || '-'}
   방법: ${c.method || '-'} | 산출물: ${outputs}
   역량: ${focus} | 개념: ${concepts} | 구조: ${c.sourceStructure || '-'}`;
    })
    .join('\n\n');

  const methodLines = methods
    .map((m) => {
      const steps = Array.isArray(m.steps) ? m.steps.join(' → ') : '-';
      const outputs = Array.isArray(m.outputs) ? m.outputs.join(', ') : '-';

      return `▸ ${m.name || m.id}: ${steps}
  산출물: ${outputs}`;
    })
    .join('\n');

  const bookLines = books
    .map((b) => `▸ 《${b.title || '도서명 없음'}》(${b.author || ''}) — ${b.use || ''}`)
    .join('\n');

  const bookInqSource =
    localDB.bookInqLines ||
    localDB.bookInquiryLines ||
    localDB.bookInquiryCases ||
    localDB.bookCases ||
    [];

  const mediaSource =
    localDB.mediaLines ||
    localDB.mediaCases ||
    localDB.openDataCases ||
    [];

  const bookInqLines = Array.isArray(bookInqSource)
    ? bookInqSource
        .slice(0, 8)
        .map((x, i) =>
          typeof x === 'string'
            ? `${i + 1}. ${x}`
            : `${i + 1}. ${x.title || x.t || '독서 연계 탐구'} — ${x.summary || x.use || x.method || ''}`
        )
        .join('\n')
    : String(bookInqSource || '');

  const mediaLines = Array.isArray(mediaSource)
    ? mediaSource
        .slice(0, 8)
        .map((x, i) =>
          typeof x === 'string'
            ? `${i + 1}. ${x}`
            : `${i + 1}. ${x.title || x.t || '미디어·오픈데이터 탐구'} — ${x.summary || x.use || x.method || ''}`
        )
        .join('\n')
    : String(mediaSource || '');

  return `[내부 DB 매칭 사례 ${cases.length}건 — 구조 참고, 복제 금지]
${caseLines || '(매칭 없음)'}

[탐구방법 DB]
${methodLines || '(없음)'}

[추천 도서 및 독서-탐구 연계]
${bookLines || '(없음)'}
${bookInqLines ? '\n[독서→탐구 연계 DB]\n' + bookInqLines : ''}
${mediaLines ? '\n[미디어·오픈데이터 탐구 사례]\n' + mediaLines : ''}

전체 DB: ${localDB.caseCount || 0}건`;
}

/* ── SYSTEM ── */
function buildSystem() {
  return `[QUESTA OS 탐구 설계 엔진]
너는 대한민국 최고의 학생부종합전형 탐구 설계 전문가다.

[출력 원칙]
- 학생에게 상담하듯 쉽게 설명
- 모든 판단에 근거 필수
- 중요 문장: <span class="focus-highlight">강조</span>
- 박스: <div class="evidence-box"><h3>제목</h3><p>내용</p></div>
- 보고서: <div class="report-section"><h3>섹션명</h3><p>내용</p></div>
- 현재 학년·학기 → 3학년 2학기 학기별 로드맵 필수

[절대 금지]
- 흔한 템플릿 제목
- 5개 주제 반복 구조
- 세부학과·2022 과목 무시한 일반론
- 가짜 책 제목·대학 사례 단정

[반드시]
- DB 구조 참고, 제목·문장 새로 만들기
- 5개 주제: 탐구방법·질문·산출물 완전히 다르게
- 세부학과와 2022 개정 과목 직접 매칭
- 로드맵 6단계 이상, 각 단계 구체적 행동·도구·산출물 포함`;
}

/* ── TOPICS PROMPT ── */
function buildTopicsPrompt(SYSTEM, profileText, dbCtx, body) {
  const sems = buildSemesterList(body.currentGrade || '1', body.currentSemester || '1').join(', ');

  return `${SYSTEM}

[학생 정보]
${profileText}
설계 기간: ${sems}

[내부 DB 참고자료]
${dbCtx}

[탐구방법 가이드]
① 데이터 분석형: 공공데이터 → 엑셀/파이썬 → 상관·회귀분석 → 시각화
② 실험·측정형: 가설 → 변인 정의 → 예비실험 → 본실험 반복 → 오차분석
③ 설문·현장조사형: 리커트 척도 → 예비조사 → 본조사 → 통계 분석
④ 모델링·시뮬레이션형: 변수 정의 → 모델 설계 → 시뮬레이션 → 민감도 분석
⑤ 정책·제도 비교형: 비교 대상 → 평가 기준 → 정량·정성 비교 → 제안
⑥ 문헌·비평형: 자료 3~5편 → 관점 추출 → 비교 기준 → 비평문
⑦ 제작·구현형: 문제정의 → 설계 → 시제품 → 사용자 테스트 → 개선
⑧ 교육 적용형: 학습자 분석 → 미니수업 → 사전사후 검사 → 오개념 분석
⑨ 윤리·쟁점 토론형: 쟁점 → 윤리 기준 → 사례 비교 → 판단 기준표

탐구 주제 5개를 추천하라.
각 주제는 탐구방법·질문·산출물이 모두 달라야 한다.
주제명에는 탐구 대상·변수·범위가 드러나야 한다.
로드맵은 6단계 이상으로 작성하라.

반드시 순수 JSON만 출력하라. 마크다운·코드블록·설명문 금지.
JSON 문자열 줄바꿈은 \\n 으로 이스케이프하라. 마지막 쉼표 금지.

{
  "topics": [
    {
      "type": "탐구유형",
      "title": "구체적 제목",
      "question": "핵심 탐구 질문",
      "summary": "3~4문장 탐구 개요",
      "majorFit": "세부학과 적합성",
      "curriculumFit": "2022 과목 연결 개념",
      "sourceCase": "참고 사례 구조 설명",
      "duplicateCheck": "다른 주제와 겹치지 않는 지점",
      "differentiator": "독창성",
      "tags": ["키1", "키2", "키3"],
      "evidence": {
        "subject": "교과 근거",
        "book": "자료 근거",
        "admission": "대학급 평가 관점"
      },
      "methodDetail": {
        "name": "탐구방법명",
        "steps": ["1단계", "2단계", "3단계", "4단계", "5단계"],
        "tools": ["도구1", "도구2"],
        "outputs": ["산출물1", "산출물2"],
        "cautions": ["주의1", "주의2"]
      },
      "roadmap": [
        {
          "title": "단계명",
          "semester": "고1-1",
          "detail": "구체적 수행 내용",
          "activities": ["교과 세특 연결", "창체/진로 활동", "탐구 수행"],
          "tools": ["도구", "방법"]
        }
      ]
    }
  ]
}`;
}

/* ── TRANSFORM PROMPT ── */
function buildTransformPrompt(SYSTEM, profileText, dbCtx, body) {
  const base = body.baseCase || {};
  const dir = body.transformDir || 'full';
  const hint = body.transformHint || '';
  const sems = buildSemesterList(body.currentGrade || '1', body.currentSemester || '1').join(', ');

  const dirGuide = {
    method: '탐구방법만 바꾸기',
    context: '맥락·대상 바꾸기',
    depth: '심화·확장',
    fusion: '융합형 변형',
    full: '완전 재설계',
  };

  return `${SYSTEM}

[학생 정보]
${profileText}
설계 기간: ${sems}

[내부 DB 참고]
${dbCtx}

[변형 대상 합격사례]
대학·학과: ${base.u || ''} / ${base.m || ''}
원본 주제: ${base.t || ''}
탐구방법: ${base.method || ''}
교과: ${base.subject || ''}
키워드: ${base.k || ''}
역량: ${(base.focus || []).join(', ')}
개념: ${(base.concepts || []).join(', ')}
산출물: ${(base.outputs || []).join(', ')}
구조유형: ${base.sourceStructure || ''}

[변형 방향]
${dirGuide[dir] || dirGuide.full}

[추가 지시]
${hint || '없음'}

변형된 탐구 주제 5개를 생성하라.
반드시 순수 JSON만 출력하라.

{
  "topics": [
    {
      "type": "탐구유형",
      "title": "구체적 제목",
      "question": "핵심 질문",
      "summary": "3~4문장 개요",
      "majorFit": "학과 적합성",
      "curriculumFit": "2022 과목 연결",
      "sourceCase": "원본 어느 부분을 어떻게 변형했는지",
      "duplicateCheck": "원본·다른 주제와 다른 지점",
      "differentiator": "독창성",
      "tags": ["키1", "키2", "키3"],
      "evidence": {
        "subject": "교과 근거",
        "book": "자료 근거",
        "admission": "대학급 관점"
      },
      "methodDetail": {
        "name": "탐구방법",
        "steps": ["1단계", "2단계", "3단계", "4단계", "5단계"],
        "tools": ["도구1", "도구2"],
        "outputs": ["산출물1", "산출물2"],
        "cautions": ["주의1", "주의2"]
      },
      "roadmap": [
        {
          "title": "단계명",
          "semester": "고1-1",
          "detail": "수행 내용",
          "activities": ["세특 연결", "창체 활동"],
          "tools": ["도구"]
        }
      ]
    }
  ]
}`;
}

/* ── COMPARE PROMPT ── */
function buildComparePrompt(SYSTEM, profileText, dbCtx, topic) {
  return `${SYSTEM}

[학생 정보]
${profileText}

[내부 DB 참고]
${dbCtx}

[선택한 탐구 주제]
제목: ${topic.title || ''}
핵심 질문: ${topic.question || ''}
탐구 유형: ${topic.type || ''}
교과 연결: ${topic.curriculumFit || ''}
탐구방법 절차: ${JSON.stringify(topic.methodDetail?.steps || [])}

상담 편지형 문단으로 평가하라.

<div class="evidence-box"><h3>① 내부 DB 유사 사례 비교</h3><p>유사 구조 사례와 차이 설명</p></div>
<div class="evidence-box"><h3>② 이 주제의 강점</h3><p>대학급과 학과 기준으로 돋보이는 이유</p></div>
<div class="evidence-box"><h3>③ 보완 방향</h3><p>부족한 점과 강화 방법</p></div>
<div class="evidence-box"><h3>④ 실제 수행 절차</h3><p>고등학생이 실제 수행하는 방법 안내</p></div>
<div class="evidence-box"><h3>⑤ 2022 개정 과목 연계</h3><p>추가 연결 과목과 개념</p></div>
<div class="evidence-box"><h3>⑥ 면접 대비 질문</h3><p>예상 질문 3가지와 답변 방향</p></div>`;
}

/* ── REPORT PROMPT ── */
function buildReportPrompt(SYSTEM, profileText, dbCtx, topic, body) {
  const sems = buildSemesterList(body.currentGrade || '1', body.currentSemester || '1').join(', ');
  const md = topic.methodDetail || {};
  const steps = Array.isArray(md.steps) ? md.steps.join(' → ') : '-';
  const tools = Array.isArray(md.tools) ? md.tools.join(', ') : '-';
  const outputs = Array.isArray(md.outputs) ? md.outputs.join(', ') : '-';
  const cautions = Array.isArray(md.cautions) ? md.cautions.join(' / ') : '-';

  return `${SYSTEM}

[학생 정보]
${profileText}
설계 기간: ${sems}

[내부 DB 참고]
${dbCtx}

[선택한 탐구 주제]
제목: ${topic.title || ''}
핵심 질문: ${topic.question || ''}
탐구 개요: ${topic.summary || ''}
탐구 유형: ${topic.type || ''}
교과 연결: ${topic.curriculumFit || ''}
학과 적합성: ${topic.majorFit || ''}
절차: ${steps}
도구: ${tools}
산출물: ${outputs}
주의사항: ${cautions}

완성형 탐구보고서 초안을 작성하라.

<div class="report-section"><h3>📋 탐구 기본 정보</h3><p>주제 / 기간(${sems}) / 방법 / 연계교과 / 목표학과 정리</p></div>
<div class="report-section"><h3>1. 탐구 동기 및 문제 인식</h3><p>구체적 계기와 문제의식</p></div>
<div class="report-section"><h3>2. 핵심 질문의 진화</h3><p>질문의 구체화 과정</p></div>
<div class="report-section"><h3>3. 이론적 배경 및 교과 개념 연결</h3><p>2022 개정 교과 개념 연결</p></div>
<div class="report-section"><h3>4. 탐구 설계 및 방법</h3><p>절차: ${steps}<br>도구: ${tools}<br>주의: ${cautions}</p></div>
<div class="report-section"><h3>5. 결과 및 해석</h3><p>산출물: ${outputs}</p></div>
<div class="report-section"><h3>6. 한계점 및 개선 방향</h3><p>표본·오차·변인 한계와 개선 방향</p></div>
<div class="report-section"><h3>7. 후속 탐구 방향</h3><p>심화 가능성</p></div>
<div class="report-section"><h3>8. 학기별 성장 로드맵</h3><p>${sems} 기준 학기별 활동</p></div>
<div class="report-section"><h3>9. 세부학과 연결 및 진로 의미</h3><p>${body.majorDetail || '목표 학과'}와의 연결</p></div>
<div class="report-section"><h3>10. 학생부 세특 예시 문장</h3><p>교사가 쓸 수 있는 세특 문장 2~3개</p></div>`;
}

/* ── UTILS ── */
function buildSemesterList(g, s) {
  const r = [];
  const startG = parseInt(g || '1', 10);
  const startS = parseInt(s || '1', 10);

  for (let grade = startG; grade <= 3; grade++) {
    for (let sem = grade === startG ? startS : 1; sem <= 2; sem++) {
      r.push(`고${grade}-${sem}`);
    }
  }

  return r;
}

function buildModelList(envModel) {
  const candidates = [
    envModel,
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ].filter(Boolean);

  return [...new Set(candidates)];
}

async function callGeminiWithFallback(args) {
  const errors = [];

  for (const model of args.modelList) {
    const result = await callGemini({ ...args, model });

    if (!result.error) {
      return { ...result, model };
    }

    errors.push(`${model}: ${result.error}`);

    if (!isModelError(result.error) && !isRetryable(result.error)) {
      break;
    }
  }

  return { error: errors.join(' | ') };
}

async function callGemini({ key, model, prompt, useSearch, mode, jsonMode }) {
  try {
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: mode === 'topics' || mode === 'transform' ? 0.88 : 0.72,
        topP: 0.9,
        maxOutputTokens: 8192,
      },
    };

    if (jsonMode) {
      payload.generationConfig.response_mime_type = 'application/json';
    }

    if (useSearch) {
      payload.tools = [{ google_search: {} }];
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await r.json();

    if (!r.ok) {
      return {
        error: data.error?.message || 'Gemini API 오류',
      };
    }

    const cand = data?.candidates?.[0];

    const text =
      cand?.content?.parts
        ?.map((p) => p.text || '')
        .join('\n') || '';

    if (!text.trim()) {
      return {
        error: 'Gemini 응답이 비어 있습니다.',
      };
    }

    return {
      text: text.trim(),
      sources: extractSrc(cand?.groundingMetadata),
    };
  } catch (e) {
    return {
      error: e.message || 'Gemini 호출 오류',
    };
  }
}

async function repairJSON({ key, modelList, badText }) {
  const prompt = `아래 텍스트를 {"topics":[...]} JSON으로 변환하라. JSON만 출력.\n\n${badText}`;

  for (const model of modelList) {
    try {
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          response_mime_type: 'application/json',
        },
      };

      let r = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      let data = await r.json();

      if (!r.ok) {
        delete payload.generationConfig.response_mime_type;

        r = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          }
        );

        data = await r.json();

        if (!r.ok) continue;
      }

      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join('\n') || '';

      if (text.trim()) {
        return { text: text.trim() };
      }
    } catch (e) {}
  }

  return { error: 'JSON 보정 실패' };
}

function isRetryable(msg) {
  const s = String(msg || '').toLowerCase();

  return (
    s.includes('google_search') ||
    s.includes('tool') ||
    s.includes('grounding') ||
    s.includes('not supported') ||
    s.includes('search') ||
    s.includes('response_mime_type') ||
    s.includes('json') ||
    s.includes('quota') ||
    s.includes('rate')
  );
}

function isModelError(msg) {
  const s = String(msg || '').toLowerCase();

  return (
    s.includes('not found') ||
    s.includes('not supported for generatecontent') ||
    s.includes('model')
  );
}

function parseJSON(text) {
  const raw = String(text || '').trim();

  let c = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(c);
  } catch (e) {}

  let s = c.indexOf('{');
  let e = c.lastIndexOf('}');

  if (s >= 0 && e > s) {
    try {
      return JSON.parse(c.slice(s, e + 1));
    } catch (err) {}
  }

  c = c.replace(/[\u0000-\u001F]+/g, ' ');

  try {
    return JSON.parse(c);
  } catch (e2) {}

  s = c.indexOf('{');
  e = c.lastIndexOf('}');

  if (s >= 0 && e > s) {
    return JSON.parse(c.slice(s, e + 1));
  }

  throw new Error('JSON 파싱 실패');
}

function tokens(s) {
  return new Set(
    String(s || '')
      .replace(/[^\w가-힣\s]/g, ' ')
      .split(/\s+/)
      .filter((x) => x.length > 1)
  );
}

function sim(a, b) {
  const A = tokens(a);
  const B = tokens(b);

  const i = [...A].filter((x) => B.has(x)).length;
  const u = new Set([...A, ...B]).size || 1;

  return i / u;
}

function badTemplate(t) {
  const tt = String(t.title || '');

  return (
    /를\s*(실험형|데이터 분석형|윤리 토론형|모델링형|교육 적용형)으로\s*탐구하는/.test(tt) ||
    /맞춤 주제$/.test(tt) ||
    /에 대한 탐구$/.test(tt) ||
    /을 통한 탐구$/.test(tt) ||
    /방법 탐구$/.test(tt)
  );
}

function dedupe(list) {
  const out = [];
  const types = new Set();

  for (const t of list) {
    if (!t?.title || !t?.question) continue;
    if (badTemplate(t)) continue;

    const key = `${t.title} ${t.question} ${t.type}`;

    if (
      out.some(
        (o) => sim(key, `${o.title} ${o.question} ${o.type}`) > 0.28
      )
    ) {
      continue;
    }

    if (types.has(t.type) && out.length < 4) {
      t.type = t.type + ' 심화';
    }

    types.add(t.type);
    out.push(t);

    if (out.length === 5) break;
  }

  return out;
}

function extractSrc(meta) {
  return (meta?.groundingChunks || [])
    .map((c) => c.web)
    .filter(Boolean)
    .map((w) => ({
      title: w.title || w.uri,
      uri: w.uri,
    }))
    .filter((x) => x.uri);
}
