export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 없습니다. Vercel 환경변수를 확인하세요.' });

  const body = req.body || {};
  const modelList = buildModelList(process.env.GEMINI_MODEL);
  const profileText = buildProfile(body);
  const dbCtx = buildDBContext(body.localDB || {});
  const SYSTEM = buildSystem();

  let prompt = '', jsonMode = true;

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
    let result = await callGeminiWithFallback({ key, modelList, prompt, useSearch: true, mode: body.mode, jsonMode });
    if (result.error && isRetryable(result.error))
      result = await callGeminiWithFallback({ key, modelList, prompt, useSearch: false, mode: body.mode, jsonMode });
    if (result.error && String(result.error).includes('response_mime_type'))
      result = await callGeminiWithFallback({ key, modelList, prompt, useSearch: false, mode: body.mode, jsonMode: false });
    if (result.error) return res.status(500).json({ error: result.error });

    if (!jsonMode) {
      const k = body.mode === 'report' ? 'report' : 'text';
      return res.status(200).json({ [k]: result.text, sources: result.sources || [], model: result.model });
    }

    let parsed;
    try { parsed = parseJSON(result.text); }
    catch (e) {
      const rep = await repairJSON({ key, modelList, badText: result.text });
      if (rep.error) return res.status(500).json({ error: 'JSON 보정 실패: ' + rep.error });
      parsed = parseJSON(rep.text);
    }
    const topics = dedupe(parsed.topics || []);
    if (topics.length < 5) return res.status(500).json({ error: '주제가 5개 미만입니다. 다시 시도해 주세요.' });
    return res.status(200).json({ topics: topics.slice(0, 5), sources: result.sources || [], model: result.model });

  } catch (e) {
    return res.status(500).json({ error: e.message || '생성 중 오류가 발생했습니다.' });
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

  const caseLines = cases.map((c, i) => {
    const outputs = Array.isArray(c.outputs) ? c.outputs.join(', ') : '-';
    const focus = Array.isArray(c.focus) ? c.focus.join(' · ') : '-';
    const concepts = Array.isArray(c.concepts) ? c.concepts.join(', ') : '-';
    return `${i + 1}. [${c.level || ''}/${c.u || ''}/${c.m || ''}] 교과:${c.subject || '-'} 키워드:${c.k || '-'}
   주제: ${c.t || '-'}
   방법: ${c.method || '-'} | 산출물: ${outputs}
   역량: ${focus} | 개념: ${concepts} | 구조: ${c.sourceStructure || '-'}`;
  }).join('\n\n');

  const methodLines = methods.map(m => {
    const steps = Array.isArray(m.steps) ? m.steps.join(' → ') : '-';
    const outputs = Array.isArray(m.outputs) ? m.outputs.join(', ') : '-';
    return `▸ ${m.name || m.id}: ${steps}\n  산출물: ${outputs}`;
  }).join('\n');

  const bookLines = books.map(b => `▸ 《${b.title}》(${b.author || ''}) — ${b.use || ''}`).join('\n');

  return `[내부 DB 매칭 사례 ${cases.length}건 — 구조 참고, 복제 금지]
${caseLines || '(매칭 없음)'}

[탐구방법 DB]
${methodLines || '(없음)'}

[추천 도서 및 독서-탐구 연계]
${bookLines || '(없음)'}
${''}
${mediaLines ? '\n[미디어·오픈데이터 탐구 사례]\n' + mediaLines : ''}

전체 DB: ${localDB.caseCount || 0}건`;
}

/* ── SYSTEM ── */
function buildSystem() {
  return `[QUESTA OS 탐구 설계 엔진]
너는 대한민국 최고의 학생부종합전형 탐구 설계 전문가다.

[출력 원칙]
- 별표(**) 나열, 마크다운 목록 중심 금지
- 학생에게 상담하듯 쉽게 설명
- 모든 판단에 근거 필수 (DB 사례 구조 / 2022 과목 개념 / 학과 요구역량 / 대학급 평가 중 2개 이상)
- 중요 문장: <span class="focus-highlight">강조</span>
- 박스: <div class="evidence-box"><h3>제목</h3><p>내용</p></div>
- 보고서: <div class="report-section"><h3>섹션명</h3><p>내용</p></div>
- 현재 학년·학기 → 3학년 2학기 학기별 로드맵 필수

[절대 금지]
- "~형으로 탐구하는 맞춤 주제" 템플릿 제목
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

[2022 개정 과목별 탐구 방향]
공통수학1·2: 함수·식·그래프 → 실제 현상 해석, 비례 모델링
대수: 지수·로그·수열 → 성장/감쇠, 점화식
미적분Ⅰ·Ⅱ: 변화율·최적화·넓이 계산
확률과 통계: 표본설계·가설검정·t검정·카이제곱
기하: 공간도형·벡터 → 궤도·구조 분석
경제 수학·인공지능 수학: 최적화·알고리즘·분류
물리학·역학·전자기: 변인통제·반복측정·오차분석·수식 유도
화학·화학 반응: 실험설계·농도/온도 변인·TLC
생명과학·세포·유전: 분자생물학 기초·통계·메타분석
지구과학·지구시스템: GIS·기상데이터·공공 관측 자료
정보·데이터 과학: 파이썬 데이터 분석·시각화·공공 API
인공지능 기초: 모델 구현·성능 평가·편향 측정
사회·문화: 사회 현상 통계·설문 설계·인터뷰
경제: 수요공급·시장실패·공공데이터 분석
법과 사회: 제도 비교·판례 분석·정책 쟁점
윤리와 사상: 논증 구조·사례 비교·판단 기준표
영어 독해와 작문: 담론 분석·논증 구조·텍스트 비교
미술 창작·영상·연극: 기획서·제작일지·비평문·포트폴리오
스포츠 과학: 신체 데이터·훈련 효과 측정

[탐구방법 10종 세밀 가이드]
① 데이터 분석형: 공공데이터(KOSIS/e-나라지표) → 엑셀/파이썬 상관·회귀분석 → 시각화 | 산출물: 분석 그래프, 상관계수표, 한계 보고서
② 실험·측정형: 가설→변인 정의→예비실험→본실험 3회 반복→오차분석 | 산출물: 실험기록지, 원자료표, 오차율
③ 설문·현장조사형: 리커트 5점 20문항→예비조사→본조사(50~150명)→t검정 | 산출물: 설문지, 코딩북, 통계표
④ 모델링·시뮬레이션형: 현상 단순화→변수 정의→모델→시뮬→민감도 분석 | 산출물: 모델 수식, 그래프, 실제값 비교
⑤ 정책·제도 비교형: 비교 대상 2~4개 선정→평가 기준→정량·정성 비교→이해관계자 분석 | 산출물: 비교표, 쟁점 지도, 제안서
⑥ 문헌·비평형: 핵심 자료 3~5편→관점 추출→비교 기준→비평문→후속 질문 | 산출물: 비교독서표, 비평문, 개념 지도
⑦ 제작·구현형: 문제정의→요구분석→설계→시제품→사용자 테스트(5~10명)→개선 | 산출물: 기획서, 프로토타입, 테스트 기록
⑧ 포트폴리오·작품분석형: 의도설정→레퍼런스 분석(5작품)→제작→피드백→비평 | 산출물: 기획서, 제작일지, 비평문
⑨ 교육 적용형: 학습자 분석→교수설계→미니수업(5~15명)→사전사후 검사→오개념 분석 | 산출물: 수업설계서, 활동지, 오개념표
⑩ 윤리·쟁점 토론형: 쟁점선정→윤리이론(공리주의/의무론)→사례비교→입장 정리→판단 기준 | 산출물: 쟁점표, 논증문, 판단기준표

[대학급별 핵심 요구]
R1 서울대·KAIST·POSTECH: 좁고 깊은 탐구, 질문 독창성, 오차·한계 인식, 자기주도 심화
R2 최상위 의약학: 변인통제, 임상 판단, 통계 신뢰성, 생명윤리
R3 연세대·고려대·성균관대·서강대: 학업 수월성, 동기→과정→발견→결론, 공동체 기여
R4 한양대·중앙대·경희대: 전공적합성, 정량 데이터, 면접 연계
R5~R6: 독서 심화, 비교 분석, 성장 서사, 진로 일관성
R7 지방거점국립대: 지역사회 연계, 과학적 분석, 전공 기초소양
R9 교대·사범대: 학습자 반응, 오개념 분석, 수업 적용
R10·R11 예체능: 포트폴리오, 작품 기획·제작, 비평 능력

[독서 연계 탐구 설계 원칙]
학생이 책 제목을 입력한 경우(history 필드에 [독서 연계] 태그):
1. 해당 도서의 핵심 주제를 탐구 출발점으로 삼아라
2. 도서 내용 → 2022 개정 과목 개념 → 실제 탐구로 이어지는 흐름을 설계하라
3. DB에 해당 책의 탐구 사례가 있으면 구조 참고 (복제 금지)
4. 독서 활동이 세특에 어떻게 연결되는지 roadmap에 명시하라

탐구 주제 5개를 추천하라.
각 주제: 탐구방법·질문·산출물 완전히 달라야 함.
주제명: 탐구 대상·변수·범위 명확히.
로드맵 6단계 이상.

반드시 순수 JSON만 출력. 마크다운·코드블록·설명문 금지.
JSON 문자열 줄바꿈 \\n 이스케이프. 마지막 쉼표 금지.

{"topics":[{"type":"탐구유형","title":"구체적 제목(변수·대상·범위 포함)","question":"핵심 탐구 질문(의문문)","summary":"3~4문장 탐구 개요","majorFit":"세부학과 적합성","curriculumFit":"2022 과목 연결 개념 2~3개","sourceCase":"참고 사례 구조 설명(출처 단정 금지)","duplicateCheck":"다른 4개와 겹치지 않는 지점","differentiator":"이 주제만의 독창성","tags":["키1","키2","키3"],"evidence":{"subject":"교과 근거","book":"도서·자료 근거","admission":"대학급 평가 관점"},"methodDetail":{"name":"탐구방법명","steps":["1단계","2단계","3단계","4단계","5단계"],"tools":["도구1","도구2"],"outputs":["산출물1","산출물2"],"cautions":["주의1","주의2"]},"roadmap":[{"title":"단계명","semester":"고1-1","detail":"구체적 수행 내용(3~4문장)","activities":["교과 세특 연결","창체/진로 활동","탐구 수행"],"tools":["도구","방법"]}]}]}`;
}

/* ── TRANSFORM PROMPT ── */
function buildTransformPrompt(SYSTEM, profileText, dbCtx, body) {
  const base = body.baseCase || {};
  const dir = body.transformDir || 'full';
  const hint = body.transformHint || '';
  const sems = buildSemesterList(body.currentGrade || '1', body.currentSemester || '1').join(', ');
  const dirGuide = {
    method: '탐구방법만 바꾸기: 원본 주제·소재 유지, 방법 완전히 교체. 원본이 데이터 분석형이면 실험·제작·설문 등으로 전환.',
    context: '맥락·대상 바꾸기: 방법·구조 유지, 적용 맥락(지역·시대·집단) 교체.',
    depth: '심화·확장: 원본 주제를 더 깊이 파고들거나 범위 확장.',
    fusion: '융합형 변형: 다른 교과·분야와 결합한 융합탐구로 재설계.',
    full: '완전 재설계: 핵심 구조(방법 선택 방식, 질문 접근, 산출물 설계)만 참고, 나머지 완전히 새로 만들기.',
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

[변형 원칙]
1. 원본 직접 복제 금지 — 구조·방법론만 참고
2. 학생의 대학급과 세부학과에 최적화
3. 2022 개정 과목 직접 연결
4. 고등학생 실제 수행 가능 수준
5. 5개 주제: 서로 다른 방법·질문·산출물
6. 독서 연계 DB 항목이 있으면 해당 책의 탐구 방향을 참고해 변형 설계하라

변형된 탐구 주제 5개를 생성하라.
반드시 순수 JSON만 출력. 마크다운·코드블록 금지.

{"topics":[{"type":"탐구유형","title":"구체적 제목","question":"핵심 질문(의문문)","summary":"3~4문장 개요","majorFit":"학과 적합성","curriculumFit":"2022 과목 연결","sourceCase":"원본 어느 부분을 어떻게 변형했는지","duplicateCheck":"원본·다른 주제와 다른 지점","differentiator":"이 변형의 독창성","tags":["키1","키2","키3"],"evidence":{"subject":"교과 근거","book":"자료 근거","admission":"대학급 관점"},"methodDetail":{"name":"탐구방법","steps":["1단계","2단계","3단계","4단계","5단계"],"tools":["도구1","도구2"],"outputs":["산출물1","산출물2"],"cautions":["주의1","주의2"]},"roadmap":[{"title":"단계명","semester":"고1-1","detail":"수행 내용","activities":["세특 연결","창체 활동"],"tools":["도구"]}]}]}`;
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

실제 대학 가이드북과 합격사례 구조를 기준으로 평가하라.
별표 나열 금지. 상담 편지형 문단.

<div class="evidence-box"><h3>① 내부 DB 유사 사례 비교</h3><p>유사 구조 사례 2~3개 제시, 이 주제와 어떻게 다른지 설명</p></div>
<div class="evidence-box"><h3>② 이 주제의 강점</h3><p>선택한 대학급과 학과 기준으로 돋보이는 이유</p></div>
<div class="evidence-box"><h3>③ 보완이 필요한 부분과 개선 방향</h3><p>부족한 점과 단계적 강화 방법</p></div>
<div class="evidence-box"><h3>④ 탐구방법 세밀화 — 실제 수행 절차·주의점</h3><p>고등학생이 실제 수행하는 구체적 방법 안내</p></div>
<div class="evidence-box"><h3>⑤ 2022 개정 과목 연계 강화</h3><p>추가 연결 가능한 2022 개정 과목과 개념</p></div>
<div class="evidence-box"><h3>⑥ 세부학과 기준 심화 방향</h3><p>해당 학과 관점에서 더 깊이 만드는 방법</p></div>
<div class="evidence-box"><h3>⑦ 중복 위험 분석 및 차별화 전략</h3><p>흔한 주제와 겹칠 위험 분석, 차별화 방법</p></div>
<div class="evidence-box"><h3>⑧ 산출물 강화 방안</h3><p>더 설득력 있는 산출물 3가지와 제작 방법</p></div>
<div class="evidence-box"><h3>⑨ 학기별 성장 로드맵</h3><p>현재~고3-2학기: 교과 세특, 창체·진로, 방학 산출물 학기별 구체적 제시</p></div>
<div class="evidence-box"><h3>⑩ 면접 대비 핵심 질문과 답변 방향</h3><p>이 탐구 기반 면접 예상 질문 3가지와 답변 방향</p></div>`;
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
학생이 실제 탐구 후 정리한 느낌으로, 과장 없이.
중요 문장: <span class="focus-highlight">강조</span>
각 섹션: <div class="report-section"><h3>섹션명</h3><p>내용</p></div>
별표 나열 금지. 문단형으로 서술.

<div class="report-section"><h3>📋 탐구 기본 정보</h3><p>주제 / 기간(${sems}) / 방법 / 연계교과 / 목표학과 표 형식 정리</p></div>
<div class="report-section"><h3>1. 탐구 동기 및 문제 인식</h3><p>수업·독서·일상에서 이 질문에 이르게 된 구체적 계기. '왜 이것이 문제인가' 설득력 있게.</p></div>
<div class="report-section"><h3>2. 핵심 질문의 진화</h3><p>처음 질문이 어떻게 구체화·심화됐는지. 최종: <span class="focus-highlight">${topic.question || ''}</span></p></div>
<div class="report-section"><h3>3. 이론적 배경 및 2022 개정 교과 개념 연결</h3><p>${topic.curriculumFit || '해당 교과'} 핵심 개념과 연결, 탐구 설계에 어떻게 적용됐는지.</p></div>
<div class="report-section"><h3>4. 참고 자료 및 선행 연구</h3><p>관련 도서·논문·데이터 출처와 각 자료가 탐구 설계에 준 영향.</p></div>
<div class="report-section"><h3>5. 탐구 설계 및 방법 — 단계별 절차</h3><p>탐구방법: ${topic.type || ''}<br>절차: ${steps}<br>도구: ${tools}<br>주의: ${cautions}<br>각 단계를 학생이 실제 수행하는 방식으로 구체적 서술.</p></div>
<div class="report-section"><h3>6. 예비 탐구 및 설계 수정</h3><p>예비 탐구 문제점과 수정 내용. 수정 전·후 대비 제시.</p></div>
<div class="report-section"><h3>7. 본 탐구 과정</h3><p>실제 수행 단계별 서술. 예상치 못한 변수, 대응, 중간 결과 포함.</p></div>
<div class="report-section"><h3>8. 결과 및 해석</h3><p>산출물: ${outputs}<br>결과 서술, 처음 질문에 어떻게 답하는지 논리적 해석.</p></div>
<div class="report-section"><h3>9. 한계점 및 개선 방향</h3><p>탐구의 한계(표본·오차·변인) 솔직하게 서술, 개선 방향 제시.</p></div>
<div class="report-section"><h3>10. 후속 탐구 방향</h3><p>해결 못한 질문, 더 심화할 수 있는 방향 2~3가지.</p></div>
<div class="report-section"><h3>11. 학기별 성장 로드맵 (${sems})</h3><p>각 학기: 어떤 교과 세특에 반영 / 창체·진로 활동 연결 / 방학 산출물 구체적 제시.</p></div>
<div class="report-section"><h3>12. 세부학과 연결 및 진로 의미</h3><p>${body.majorDetail || '목표 학과'}에서 이 탐구가 보여주는 역량, 전공 공부와의 연결.</p></div>
<div class="report-section"><h3>13. 학생부 세특 예시 문장</h3><p>이 탐구를 세특에 기록할 핵심 문장 2~3개. 교사가 실제 쓸 수 있는 형식.</p></div>
<div class="report-section"><h3>14. 면접 핵심 답변 소재</h3><p>이 탐구 기반 면접 예상 질문 3가지와 답변 방향.</p></div>`;
}

/* ── UTILS ── */
function buildSemesterList(g, s) {
  const r = [];
  for (let grade = parseInt(g); grade <= 3; grade++) {
    for (let sem = (grade === parseInt(g) ? parseInt(s) : 1); sem <= 2; sem++) {
      r.push(`고${grade}-${sem}`);
    }
  }
  return r;
}

function buildModelList(envModel) {
  const c = [envModel, 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'].filter(Boolean);
  return [...new Set(c)];
}

async function callGeminiWithFallback(args) {
  const errors = [];
  for (const model of args.modelList) {
    const result = await callGemini({ ...args, model });
    if (!result.error) return { ...result, model };
    errors.push(`${model}: ${result.error}`);
    if (!isModelError(result.error) && !isRetryable(result.error)) break;
  }
  return { error: errors.join(' | ') };
}

async function callGemini({ key, model, prompt, useSearch, mode, jsonMode }) {
  try {
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: mode === 'topics' || mode === 'transform' ? 0.88 : 0.72,
        topP: 0.9,
        maxOutputTokens: mode === 'topics' || mode === 'transform' ? 12000 : 10000,
      },
    };
    if (jsonMode) payload.generationConfig.response_mime_type = 'application/json';
    if (useSearch) payload.tools = [{ google_search: {} }];
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) return { error: data.error?.message || 'Gemini API 오류' };
    const cand = data?.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text || '').join('\n') || '';
    if (!text.trim()) return { error: 'Gemini 응답이 비어 있습니다.' };
    return { text: text.trim(), sources: extractSrc(cand?.groundingMetadata) };
  } catch (e) { return { error: e.message || 'Gemini 호출 오류' }; }
}

async function repairJSON({ key, modelList, badText }) {
  const prompt = `아래 텍스트를 {"topics":[...]} JSON으로 변환하라. JSON만 출력.\n\n${badText}`;
  for (const model of modelList) {
    try {
      const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 12000, response_mime_type: 'application/json' } };
      let r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      let data = await r.json();
      if (!r.ok) { delete payload.generationConfig.response_mime_type; r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); data = await r.json(); if (!r.ok) continue; }
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
      if (text.trim()) return { text: text.trim() };
    } catch (e) { }
  }
  return { error: 'JSON 보정 실패' };
}

function isRetryable(msg) { const s = String(msg || '').toLowerCase(); return s.includes('google_search') || s.includes('tool') || s.includes('grounding') || s.includes('not supported') || s.includes('search') || s.includes('response_mime_type') || s.includes('json'); }
function isModelError(msg) { const s = String(msg || '').toLowerCase(); return s.includes('not found') || s.includes('not supported for generatecontent') || s.includes('model'); }

function parseJSON(text) {
  const raw = String(text || '').trim();
  let c = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(c); } catch (e) { }
  let s = c.indexOf('{'), e = c.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(c.slice(s, e + 1)); } catch (err) { } }
  c = c.replace(/[\u0000-\u001F]+/g, ' ');
  try { return JSON.parse(c); } catch (e2) { }
  s = c.indexOf('{'); e = c.lastIndexOf('}');
  if (s >= 0 && e > s) return JSON.parse(c.slice(s, e + 1));
  throw new Error('JSON 파싱 실패');
}

function tokens(s) { return new Set(String(s || '').replace(/[^\w가-힣\s]/g, ' ').split(/\s+/).filter(x => x.length > 1)); }
function sim(a, b) { const A = tokens(a), B = tokens(b); const i = [...A].filter(x => B.has(x)).length; const u = new Set([...A, ...B]).size || 1; return i / u; }
function badTemplate(t) { const tt = String(t.title || ''); return /를\s*(실험형|데이터 분석형|윤리 토론형|모델링형|교육 적용형)으로\s*탐구하는/.test(tt) || /맞춤 주제$/.test(tt) || /에 대한 탐구$/.test(tt) || /을 통한 탐구$/.test(tt) || /방법 탐구$/.test(tt); }
function dedupe(list) {
  const out = [], types = new Set();
  for (const t of list) {
    if (!t?.title || !t?.question) continue;
    if (badTemplate(t)) continue;
    const key = `${t.title} ${t.question} ${t.type}`;
    if (out.some(o => sim(key, `${o.title} ${o.question} ${o.type}`) > 0.28)) continue;
    if (types.has(t.type) && out.length < 4) t.type = t.type + ' 심화';
    types.add(t.type); out.push(t);
    if (out.length === 5) break;
  }
  return out;
}
function extractSrc(meta) { return (meta?.groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ title: w.title || w.uri, uri: w.uri })).filter(x => x.uri); }
