export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const body=req.body||{};
  const key=process.env.GEMINI_API_KEY;
  const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
  if(!key) return res.status(500).json({error:"GEMINI_API_KEY 환경변수가 없습니다. 템플릿 fallback은 비활성화되어 있습니다."});

  const profile=`
대학급: ${body.level}
계열: ${body.track}
세부학과: ${body.majorDetail}
2022 과목군: ${body.subjectGroup}
2022 개정 과목: ${body.subject}
탐구 성향: ${body.style}
학생 수준: ${body.studentLevel}
관심 키워드: ${body.keyword}
기존 활동/독서: ${body.history||"없음"}
`;

  const system=`
너는 고등학생 탐구활동 설계 전문가이자 학생부종합전형 평가관 관점의 코치다.

절대 금지:
- 템플릿 제목 금지. 예: "~를 실험형으로 탐구하는 ~ 맞춤 주제" 같은 표현 금지.
- 5개 주제의 문장 구조 반복 금지.
- 같은 핵심 질문 반복 금지.
- 실제 사례 제목·문장 복제 금지.
- 세부학과와 2022 개정 과목이 반영되지 않은 일반론 금지.
- 가짜 책 제목, 가짜 대학 사례를 단정하지 말 것.

반드시 수행:
- Google Search로 공개 대학 학생부종합전형 가이드북, 우수 탐구 사례, 세부학과 관련 탐구방법을 확인한다.
- 실제 사례는 제목이 아니라 구조만 추출한다.
- 5개 추천은 탐구 세계가 완전히 달라야 한다.
- 각 주제는 세부학과와 2022 개정 과목의 성격에 직접 맞아야 한다.
- 예체능이면 포트폴리오, 작품 분석, 제작 과정, 신체/감각 데이터, 비평문, 실기 기록 등을 포함한다.
- 실제 학생이 한 것처럼 질문 변화, 예비 실행, 수정 흔적, 산출물을 넣는다.
`;

  let prompt="";
  let jsonMode=true;

  if(body.mode==="topics"){
    prompt=`
${system}

학생 정보:
${profile}

2022 개정 과목별 탐구 방향 예시:
- 공통수학1·2: 함수, 식, 그래프를 실제 현상 해석으로 연결
- 대수: 수열, 지수·로그 구조를 변화와 성장 모델로 연결
- 미적분Ⅰ·Ⅱ: 변화율, 누적, 최적화, 모델링
- 확률과 통계: 불확실성, 표본, 조건부 판단, 설문·실험 설계
- 기하: 공간, 벡터, 시각화, 설계·동선·구조 분석
- 경제 수학: 비용·효과, 선택, 최적화, 금융 의사결정
- 인공지능 수학: 데이터, 분류, 예측, 알고리즘 편향
- 영어 독해와 작문·미디어 영어: 담론 분석, 텍스트 비교, 번역·표현 전략
- 사회문제 탐구·정치·법과 사회: 정책 비교, 윤리, 제도 효과
- 과학탐구실험·물리학·화학·생명과학: 변수 통제, 반복 측정, 오차 분석
- 데이터 과학·인공지능 기초: 데이터 수집, 시각화, 모델 한계
- 미술 창작·영상 제작·연극: 작품 기획, 제작 과정, 비평, 포트폴리오
- 스포츠 과학·운동과 건강: 신체 데이터, 훈련 효과, 측정과 피드백

추천순위 5개를 생성하라.
각 주제는 반드시 다른 탐구방법·다른 산출물·다른 질문 방향이어야 한다.

JSON만 출력:
{
 "topics":[
  {
   "type":"서로 다른 탐구유형",
   "title":"구체적이고 중복되지 않는 제목",
   "question":"핵심 질문",
   "summary":"학생이 실제 할 수 있는 구체적 탐구 설명",
   "majorFit":"세부학과와 맞는 이유",
   "curriculumFit":"2022 개정 과목과 맞는 이유",
   "sourceCase":"실제 공개 사례/가이드북에서 참고한 구조 설명",
   "duplicateCheck":"다른 추천과 겹치지 않는 지점",
   "differentiator":"차별화 한 줄",
   "tags":["태그1","태그2","태그3"],
   "evidence":{
    "subject":"2022 과목 연결 근거",
    "book":"도서/자료 연결 근거",
    "admission":"대학급 평가 관점"
   },
   "roadmap":[
    {"title":"단계명","detail":"실제 행동, 근거, 산출물, 수정 흔적 포함"}
   ]
  }
 ]
}
`;
  } else if(body.mode==="compare"){
    jsonMode=false;
    prompt=`${system}\n학생 정보:\n${profile}\n선택 주제:\n${JSON.stringify(body.selectedTopic,null,2)}
실제 대학 가이드북/우수사례 구조와 비교해 평가하라.
항목: 닮은 사례 구조, 부족한 점, 세부학과 기준 보완, 2022 과목 기준 보완, 중복 위험, 산출물 보완, 대학급별 수정 방향.`;
  } else if(body.mode==="report"){
    jsonMode=false;
    prompt=`${system}\n학생 정보:\n${profile}\n선택 주제:\n${JSON.stringify(body.selectedTopic,null,2)}
탐구 보고서 초안을 작성하라.
문체는 학생이 실제 탐구 후 정리한 느낌으로 하되, 과장하지 말라.
항목: 주제, 동기, 질문 변화, 2022 과목 개념 연결, 자료/도서 근거, 탐구 설계, 예비 실행과 수정, 본 탐구, 결과 해석, 한계, 후속 탐구, 세부학과 연결.`;
  } else {
    return res.status(400).json({error:"지원하지 않는 mode입니다."});
  }

  try{
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts:[{text:prompt}]}],
        tools:[{google_search:{}}],
        generationConfig:{temperature:body.mode==="topics"?0.95:0.68,topP:0.9,maxOutputTokens:body.mode==="topics"?8000:6000}
      })
    });
    const data=await r.json();
    if(!r.ok) return res.status(500).json({error:data.error?.message||"Gemini API 오류"});
    const cand=data?.candidates?.[0];
    const text=cand?.content?.parts?.map(p=>p.text||"").join("\n")||"";
    const sources=extractSources(cand?.groundingMetadata);
    if(!text.trim()) return res.status(500).json({error:"Gemini 응답이 비어 있습니다."});
    if(!jsonMode) return res.status(200).json(body.mode==="report"?{report:text.trim(),sources}:{text:text.trim(),sources});
    const parsed=parseJSON(text);
    const topics=dedupe(parsed.topics||[]);
    if(topics.length<5) return res.status(500).json({error:"중복 제거 후 남은 주제가 5개 미만입니다. 다시 생성해 주세요."});
    return res.status(200).json({topics:topics.slice(0,5),sources});
  }catch(e){
    return res.status(500).json({error:e.message||"생성 중 오류가 발생했습니다."});
  }
}

function parseJSON(text){
  const cleaned=String(text).replace(/```json/g,"").replace(/```/g,"").trim();
  try{return JSON.parse(cleaned)}catch(e){}
  const s=cleaned.indexOf("{"), e=cleaned.lastIndexOf("}");
  if(s>=0&&e>s) return JSON.parse(cleaned.slice(s,e+1));
  throw new Error("JSON 파싱 실패");
}
function tokens(s){return new Set(String(s||"").replace(/[^\w가-힣\s]/g," ").split(/\s+/).filter(x=>x.length>1))}
function sim(a,b){const A=tokens(a),B=tokens(b);const inter=[...A].filter(x=>B.has(x)).length;const union=new Set([...A,...B]).size||1;return inter/union}
function dedupe(list){
  const out=[]; const types=new Set();
  for(const t of list){
    if(!t?.title||!t?.question) continue;
    const key=`${t.title} ${t.question} ${t.type}`;
    if(out.some(o=>sim(key,`${o.title} ${o.question} ${o.type}`)>0.34)) continue;
    if(types.has(t.type)&&out.length<4) t.type=t.type+" 심화 변형";
    types.add(t.type);
    out.push(t);
    if(out.length===5) break;
  }
  return out;
}
function extractSources(meta){
  const chunks=meta?.groundingChunks||[];
  return chunks.map(c=>c.web).filter(Boolean).map(w=>({title:w.title||w.uri,uri:w.uri})).filter(x=>x.uri);
}
