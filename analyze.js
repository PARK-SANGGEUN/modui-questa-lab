export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const body=req.body||{};
  const key=process.env.GEMINI_API_KEY;
  const model=process.env.GEMINI_MODEL||"gemini-1.5-flash";
  if(!key) return res.status(500).json({error:"GEMINI_API_KEY 환경변수가 없습니다."});

  const profile=`
대학급: ${body.level}
계열: ${body.track}
세부학과: ${body.majorDetail}
2022 과목군: ${body.subjectGroup}
2022 개정 과목: ${body.subject}
관심 키워드: ${body.keyword||"없음"}
기존 활동/독서: ${body.history||"없음"}
`;

  const SYSTEM=`
너는 대한민국 최고의 학생부종합전형 탐구 설계 전문가이자 입시 컨설턴트다.
Google 검색으로 대학 학생부종합전형 가이드북, 합격생 세특 사례, 에듀진·메가스터디·설탭·나무아카데미 등 입시 매거진을 실시간 참고해 탐구를 설계한다.

[절대 금지]
- "~를 실험형으로 탐구하는 ~ 맞춤 주제" 같은 템플릿 제목
- 5개 주제의 문장 구조·질문 방식·산출물 반복
- 같은 핵심 질문 반복
- 세부학과·2022 과목이 반영되지 않은 일반론
- 가짜 책 제목·가짜 대학 사례를 단정
- "~에 대한 탐구", "~를 통한 탐구", "~하는 방법 탐구" 형태 제목

[반드시 수행]
- Google 검색으로 "${body.majorDetail} 합격 탐구주제 세특", "${body.level} 학생부종합 우수사례", "${body.subject} 탐구 사례"를 검색해 실제 합격 구조를 파악한다
- 5개 추천은 탐구 방법·질문 세계·산출물이 완전히 달라야 한다
- 각 주제는 세부학과와 2022 개정 과목에 직접 매칭
- 예체능이면 포트폴리오·작품분석·제작과정·신체데이터·비평문·실기기록 포함
- 로드맵 각 단계에 구체적 행동(도구·자료·측정방법·수정과정)을 포함하고 6단계 이상 작성
- 중복탐구 위험 분석과 차별화 전략을 명시
`;

  let prompt="",jsonMode=true;

  if(body.mode==="topics"){
    prompt=`${SYSTEM}

학생 정보:
${profile}

[Google 검색 요청]
다음을 검색해 실제 합격 사례 구조를 파악하라:
1. "${body.majorDetail} 학생부종합전형 합격 탐구주제 세특 사례"
2. "${body.level.replace(/\s*\(.*\)/,"").trim()} 합격생 탐구 방법"
3. "${body.subject} 탐구 우수 사례 2024 2025"
4. "${body.track} 계열 학생부종합 가이드북 탐구 사례"

[2022 개정 과목별 탐구 방향]
- 공통수학1·2: 함수·식·그래프를 실제 현상 해석으로 연결
- 대수·미적분Ⅰ·Ⅱ: 변화율·누적·최적화·수리 모델링
- 확률과 통계: 설문설계·가설검정·표본분석·조건부 판단
- 기하: 공간·벡터·시각화·설계·구조 분석
- 경제 수학·인공지능 수학: 최적화·알고리즘·데이터 모델
- 영어 독해와 작문: 담론 분석·텍스트 비교·번역 전략
- 사회문제 탐구·경제·정치·법과 사회: 정책 비교·윤리·제도 효과·데이터
- 과학탐구실험·물리학·화학·생명과학·지구과학: 변수통제·반복측정·오차분석·통계
- 데이터 과학·인공지능 기초·정보: 데이터수집·시각화·모델한계·구현
- 미술 창작·영상 제작·연극: 작품 기획·제작·비평·포트폴리오
- 스포츠 과학·운동과 건강: 신체 데이터·훈련 효과·측정·피드백

[대학급별 탐구 핵심 요구]
- 서울대/KAIST/POSTECH: 좁고 깊은 탐구·오차분석·질문 독창성·자기주도 심화·전 교과 이수
- 연세대/고려대: 학업 수월성·동기→과정→발견→결론 스토리라인·공동체 기여
- 성균관대/서강대/한양대: 전공적합성·정량 데이터·면접 연계 가능 주제
- 중앙대/경희대/외대/시립대: 성장 스토리·직접 수행 방법·세특 일관성
- 교대/사범대: 교직 인성·교육 문제 해결·아동·학습자 관점
- 과기원(GIST·DGIST·UNIST): 복수 학문 융합·자기주도성·이타적 리더십
- 지방거점국립대: 지역사회 문제 연계·과학적 분석·전공 기초소양
- 예체능: 포트폴리오·실기+이론·작품 기획 과정·비평 능력

구체적인 탐구 주제 5개를 추천하라.
각 주제는 탐구방법·산출물·질문 방향이 완전히 달라야 한다.
주제명은 구체적이고 탐구 대상·변수·범위가 명확해야 한다.
로드맵은 6단계 이상, 각 단계에 실제 행동·도구·산출물·수정 흔적을 포함하라.

순수 JSON만 출력 (마크다운·코드블록 금지):
{
 "topics":[
  {
   "type":"탐구유형 (데이터분석형·실험설계형·비교문헌형·정책분석형·창작비평형·모델링형·현장조사형·메타분석형 중 — 5개가 모두 달라야 함)",
   "title":"구체적이고 중복되지 않는 제목 (탐구 대상·변수·범위 명확히 포함)",
   "question":"학생이 실제로 품은 핵심 질문 (교과 수업에서 자연스럽게 출발한 것처럼)",
   "summary":"학생이 실제로 할 수 있는 구체적 탐구 설명 (3~4문장, 탐구방법·예상 산출물 포함)",
   "majorFit":"세부학과와 맞는 이유 (직접 연결 설명, 2~3문장)",
   "curriculumFit":"2022 개정 과목과 맞는 이유 (교과 개념·단원명 직접 언급)",
   "sourceCase":"Google 검색으로 찾은 실제 사례/가이드북 구조 설명 (출처명 단정 금지, '~와 유사한 구조' 형식, 구체적으로)",
   "duplicateCheck":"다른 4개 추천과 겹치지 않는 지점 (방법·산출물·질문 기준으로 명확히)",
   "differentiator":"이 주제만의 차별화 포인트 한 줄",
   "tags":["태그1","태그2","태그3"],
   "evidence":{
    "subject":"2022 과목 연결 근거 — 교과서 단원·개념명 직접 언급",
    "book":"도서/논문/데이터 연결 근거 — 실제 존재 가능한 자료 제안 (저자·출판사 포함 가능)",
    "admission":"대학급 평가 관점 — 왜 이 대학급에서 유리한지 구체적으로"
   },
   "roadmap":[
    {
     "title":"단계명 (동사형으로)",
     "detail":"실제 행동·근거·산출물·수정 흔적 포함 (3~5문장). 어떤 도구·자료·방법을 쓰는지 구체적으로. 예비 실험이나 실패 경험도 포함.",
     "tools":["사용 도구1","방법2","자료3"]
    }
   ]
  }
 ]
}
`;
  } else if(body.mode==="compare"){
    jsonMode=false;
    prompt=`${SYSTEM}

학생 정보: ${profile}

선택 주제: ${JSON.stringify(body.selectedTopic,null,2)}

Google 검색으로 다음을 찾아 비교 분석하라:
1. "${body.majorDetail||""} 합격 탐구주제 사례 세특"
2. 이 주제와 유사한 합격생 탐구 구조
3. "${body.level?.replace(/\s*\(.*\)/,"").trim()||""} 학생부종합전형 우수 탐구"

다음 항목을 분석하라:
1. 실제 합격 사례 중 유사한 구조 (어느 대학·학과 사례와 닮았는가, 구체적으로)
2. 이 주제의 강점 (어떤 평가 요소에서 왜 유리한가)
3. 부족한 점과 구체적 보완 방향 (3가지 이상)
4. 2022 개정 과목 연계 강화 방법
5. 세부학과 기준 추가 심화 방향
6. 중복 위험 분석 (비슷한 주제가 흔한가, 어떻게 차별화할 수 있나)
7. 산출물 강화 방안 (보고서·발표·포트폴리오 형태 구체적 제안)
8. 대학급별 맞춤 수정 방향 (더 상위권/현재/하위권)
`;
  } else if(body.mode==="report"){
    jsonMode=false;
    prompt=`${SYSTEM}

학생 정보: ${profile}

선택 주제: ${JSON.stringify(body.selectedTopic,null,2)}

완성형 탐구 보고서 초안을 작성하라.
문체는 학생이 실제 탐구 후 정리한 느낌으로 작성하되, 과장하지 말라.
출력하면 그대로 제출·참고 가능한 수준으로 섹션을 명확히 구분하라.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
탐 구 보 고 서
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▌ 탐구 주제
(선택 주제 제목)

▌ 탐구 기간
(예: 20XX년 X월 ~ X월, 총 X주)

▌ 탐구 동기
(교과 수업에서 어떤 개념을 배우다가 이 질문이 생겼는지 — 3~4문장. 자연스럽게 교과→질문→탐구 동기 서술)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 질문의 진화
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① 처음 질문: (교과 수업에서 생긴 최초 의문)
② 심화 질문 1: (더 구체화된 질문)
③ 심화 질문 2: (변수·조건 설정)
④ 최종 탐구 질문: (실제 탐구한 핵심 질문)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 이론적 배경 및 교과 개념 연결
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(사용한 2022 개정 교육과정 개념 2~3가지를 명확히 설명하고, 탐구와 어떻게 연결되는지 — 각 개념당 3~5줄)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 참고 자료 및 선행 연구
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(실제 사용하거나 참고한 자료 3~4개 — 실존 가능한 것으로. 도서/논문/공공데이터 포함)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 탐구 설계
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 탐구 방법: (구체적으로)
• 독립변수: 
• 종속변수:
• 통제변수:
• 데이터 수집 방법:
• 예상 산출물:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 예비 탐구 및 수정 과정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(처음 탐구에서 발견한 문제점과 수정한 내용 — 실패 경험과 재설계 과정 포함)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 본 탐구 과정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1단계: (구체적 행동·자료·도구 포함)
2단계:
3단계:
4단계:
5단계:
6단계:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. 결과 및 해석
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(구체적 수치·패턴·비교를 포함한 결과 기술 — 3~5문장. 과장 금지)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. 한계점 및 개선 방향
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 방법의 한계:
• 자료의 한계:
• 개선 방향:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. 후속 탐구 방향
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(이 탐구를 더 심화하려면, 대학 진학 후 어떤 연구로 이어질 수 있는지)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. 세부학과 연결 및 진로 의미
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(이 탐구가 ${body.majorDetail}에서 어떤 의미를 가지는지 — 전공 기초소양과 연결)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[학생부 세부능력특기사항 기재 예시]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(교사 시점으로 500자 내외. 탐구 동기→과정→결과→성장 흐름으로. 구체적 수치·활동 포함)

[면접 핵심 답변 소재 3가지]
① 
②
③
`;
  } else {
    return res.status(400).json({error:"지원하지 않는 mode입니다."});
  }

  try{
    let result=await callGemini({key,model,prompt,useSearch:true,mode:body.mode});
    if(result.error&&isSearchErr(result.error)){
      result=await callGemini({key,model,prompt,useSearch:false,mode:body.mode});
    }
    if(result.error) return res.status(500).json({error:result.error});

    if(!jsonMode){
      const k=body.mode==="report"?"report":"text";
      return res.status(200).json({[k]:result.text,sources:result.sources});
    }

    const parsed=parseJSON(result.text);
    const topics=dedupe(parsed.topics||[]);
    if(topics.length<5) return res.status(500).json({error:"중복 제거 후 주제가 5개 미만입니다. 다시 생성해 주세요."});
    return res.status(200).json({topics:topics.slice(0,5),sources:result.sources});
  }catch(e){
    return res.status(500).json({error:e.message||"생성 중 오류가 발생했습니다."});
  }
}

async function callGemini({key,model,prompt,useSearch,mode}){
  try{
    const payload={
      contents:[{role:"user",parts:[{text:prompt}]}],
      generationConfig:{
        temperature:mode==="topics"?0.95:0.70,
        topP:0.92,
        maxOutputTokens:mode==="topics"?10000:8000
      }
    };
    if(useSearch) payload.tools=[{google_search:{}}];
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
    });
    const data=await r.json();
    if(!r.ok) return {error:data.error?.message||"Gemini API 오류"};
    const cand=data?.candidates?.[0];
    const text=cand?.content?.parts?.map(p=>p.text||"").join("\n")||"";
    if(!text.trim()) return {error:"Gemini 응답이 비어 있습니다."};
    return {text:text.trim(),sources:extractSrc(cand?.groundingMetadata)};
  }catch(e){return {error:e.message||"Gemini 호출 오류"}}
}

function isSearchErr(msg){const s=String(msg||"").toLowerCase();return s.includes("google_search")||s.includes("tool")||s.includes("grounding")||s.includes("not supported")||s.includes("search")}
function parseJSON(text){
  const c=String(text).replace(/```json/g,"").replace(/```/g,"").trim();
  try{return JSON.parse(c)}catch{}
  const s=c.indexOf("{"),e=c.lastIndexOf("}");
  if(s>=0&&e>s) try{return JSON.parse(c.slice(s,e+1))}catch{}
  throw new Error("JSON 파싱 실패 — 다시 생성해 주세요.");
}
function tokens(s){return new Set(String(s||"").replace(/[^\w가-힣\s]/g," ").split(/\s+/).filter(x=>x.length>1))}
function sim(a,b){const A=tokens(a),B=tokens(b);const i=[...A].filter(x=>B.has(x)).length;const u=new Set([...A,...B]).size||1;return i/u}
function badTemplate(t){
  const title=String(t.title||"");
  return /를\s*(실험형|데이터 분석형|윤리 토론형|모델링형|교육 적용형)으로\s*탐구하는/.test(title)||
    /맞춤 주제$/.test(title)||/에 대한 탐구$/.test(title)||
    /을 통한 탐구$/.test(title)||/방법 탐구$/.test(title)||
    /하는 방법$/.test(title);
}
function dedupe(list){
  const out=[],types=new Set();
  for(const t of list){
    if(!t?.title||!t?.question) continue;
    if(badTemplate(t)) continue;
    const key=`${t.title} ${t.question} ${t.type}`;
    if(out.some(o=>sim(key,`${o.title} ${o.question} ${o.type}`)>0.28)) continue;
    if(types.has(t.type)&&out.length<4) t.type=t.type+" 심화";
    types.add(t.type);
    out.push(t);
    if(out.length===5) break;
  }
  return out;
}
function extractSrc(meta){
  return(meta?.groundingChunks||[]).map(c=>c.web).filter(Boolean)
    .map(w=>({title:w.title||w.uri,uri:w.uri})).filter(x=>x.uri);
}
