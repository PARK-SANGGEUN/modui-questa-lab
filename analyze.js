export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const body=req.body||{};
  const key=process.env.GEMINI_API_KEY;
  const model=process.env.GEMINI_MODEL||"gemini-1.5-flash";
  if(!key) return res.status(500).json({error:"GEMINI_API_KEY 환경변수가 없습니다. Vercel 환경변수를 확인하세요."});

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

탐구성향과 학생수준은 사용자가 선택하지 않는다.
대학급, 세부학과, 2022 개정 과목, 관심 키워드를 보고 자동으로 판단한다.

[절대 금지]
- "~를 실험형으로 탐구하는 ~ 맞춤 주제" 같은 템플릿 제목
- 5개 주제의 문장 구조·질문 방식·산출물 반복
- 같은 핵심 질문 반복
- 세부학과·2022 과목이 반영되지 않은 일반론
- 가짜 책 제목·가짜 대학 사례를 단정
- "~에 대한 탐구", "~를 통한 탐구", "~하는 방법 탐구" 형태 제목

[반드시 수행]
- 대학 학생부종합전형 가이드북, 합격생 세특 사례, 입시 매거진의 '구조'를 참고하되 제목과 문장은 새로 만든다.
- 5개 추천은 탐구 방법·질문 세계·산출물이 완전히 달라야 한다.
- 각 주제는 세부학과와 2022 개정 과목에 직접 매칭되어야 한다.
- 예체능이면 포트폴리오·작품분석·제작과정·신체데이터·비평문·실기기록을 포함한다.
- 로드맵 각 단계에 구체적 행동, 도구, 자료, 측정방법, 수정과정을 포함하고 6단계 이상 작성한다.
- 중복탐구 위험 분석과 차별화 전략을 명시한다.
`;

  let prompt="", jsonMode=true;

  if(body.mode==="topics"){
    prompt=`${SYSTEM}

학생 정보:
${profile}

가능하면 Google Search를 활용해 다음 구조를 참고하라. 검색 연결이 안 되더라도 네 지식으로 생성하라.
1. "${body.majorDetail||""} 학생부종합전형 합격 탐구주제 세특 사례"
2. "${body.level||""} 합격생 탐구 방법"
3. "${body.subject||""} 탐구 우수 사례"
4. "${body.track||""} 계열 학생부종합 가이드북 탐구 사례"

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
- 과기원: 복수 학문 융합·자기주도성·이타적 리더십
- 지방거점국립대: 지역사회 문제 연계·과학적 분석·전공 기초소양
- 예체능: 포트폴리오·실기+이론·작품 기획 과정·비평 능력

구체적인 탐구 주제 5개를 추천하라.
각 주제는 탐구방법·산출물·질문 방향이 완전히 달라야 한다.
주제명은 구체적이고 탐구 대상·변수·범위가 명확해야 한다.
로드맵은 6단계 이상, 각 단계에 실제 행동·도구·산출물·수정 흔적을 포함하라.

매우 중요:
반드시 순수 JSON만 출력한다. 마크다운, 코드블록, 설명문, 주석 금지.
JSON 문자열 안의 줄바꿈은 \\n 으로 이스케이프한다.
마지막 쉼표 금지.

{
 "topics":[
  {
   "type":"탐구유형",
   "title":"구체적이고 중복되지 않는 제목",
   "question":"학생이 실제로 품은 핵심 질문",
   "summary":"학생이 실제로 할 수 있는 구체적 탐구 설명",
   "majorFit":"세부학과와 맞는 이유",
   "curriculumFit":"2022 개정 과목과 맞는 이유",
   "sourceCase":"실제 사례/가이드북에서 참고한 구조 설명. 출처명 단정 금지",
   "duplicateCheck":"다른 추천과 겹치지 않는 지점",
   "differentiator":"이 주제만의 차별화 포인트",
   "tags":["태그1","태그2","태그3"],
   "evidence":{
    "subject":"2022 과목 연결 근거",
    "book":"도서/논문/데이터 연결 근거",
    "admission":"대학급 평가 관점"
   },
   "roadmap":[
    {
     "title":"단계명",
     "detail":"실제 행동·근거·산출물·수정 흔적 포함",
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

학생 정보:
${profile}

선택 주제:
${JSON.stringify(body.selectedTopic,null,2)}

실제 대학 가이드북/우수사례 구조와 비교해 평가하라.
항목:
1. 실제 합격 사례 중 유사한 구조
2. 이 주제의 강점
3. 부족한 점과 구체적 보완 방향
4. 2022 개정 과목 연계 강화 방법
5. 세부학과 기준 추가 심화 방향
6. 중복 위험 분석
7. 산출물 강화 방안
8. 대학급별 맞춤 수정 방향`;
  } else if(body.mode==="report"){
    jsonMode=false;
    prompt=`${SYSTEM}

학생 정보:
${profile}

선택 주제:
${JSON.stringify(body.selectedTopic,null,2)}

완성형 탐구 보고서 초안을 작성하라.
문체는 학생이 실제 탐구 후 정리한 느낌으로 작성하되, 과장하지 말라.
섹션:
탐구 주제, 탐구 기간, 탐구 동기, 질문의 진화, 이론적 배경 및 교과 개념 연결, 참고 자료 및 선행 연구, 탐구 설계, 예비 탐구 및 수정 과정, 본 탐구 과정, 결과 및 해석, 한계점 및 개선 방향, 후속 탐구 방향, 세부학과 연결 및 진로 의미, 학생부 세특 예시, 면접 핵심 답변 소재.`;
  } else {
    return res.status(400).json({error:"지원하지 않는 mode입니다."});
  }

  try{
    let result=await callGemini({key,model,prompt,useSearch:true,mode:body.mode,jsonMode});
    if(result.error && isRetryable(result.error)){
      result=await callGemini({key,model,prompt,useSearch:false,mode:body.mode,jsonMode});
    }
    if(result.error && String(result.error).includes("response_mime_type")){
      result=await callGemini({key,model,prompt,useSearch:false,mode:body.mode,jsonMode:false});
    }
    if(result.error) return res.status(500).json({error:result.error});

    if(!jsonMode){
      const k=body.mode==="report"?"report":"text";
      return res.status(200).json({[k]:result.text,sources:result.sources||[]});
    }

    let parsed;
    try{
      parsed=parseJSON(result.text);
    }catch(e){
      const repaired=await repairJSON({key,model,badText:result.text});
      if(repaired.error) return res.status(500).json({error:"JSON 보정 실패: "+repaired.error});
      parsed=parseJSON(repaired.text);
    }

    const topics=dedupe(parsed.topics||[]);
    if(topics.length<5) return res.status(500).json({error:"중복 제거 후 주제가 5개 미만입니다. 다시 생성해 주세요."});
    return res.status(200).json({topics:topics.slice(0,5),sources:result.sources||[]});
  }catch(e){
    return res.status(500).json({error:e.message||"생성 중 오류가 발생했습니다."});
  }
}

async function callGemini({key,model,prompt,useSearch,mode,jsonMode}){
  try{
    const payload={
      contents:[{role:"user",parts:[{text:prompt}]}],
      generationConfig:{
        temperature:mode==="topics"?0.88:0.70,
        topP:0.9,
        maxOutputTokens:mode==="topics"?10000:8000
      }
    };
    if(jsonMode) payload.generationConfig.response_mime_type="application/json";
    if(useSearch) payload.tools=[{google_search:{}}];

    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    const data=await r.json();
    if(!r.ok) return {error:data.error?.message||"Gemini API 오류"};
    const cand=data?.candidates?.[0];
    const text=cand?.content?.parts?.map(p=>p.text||"").join("\n")||"";
    if(!text.trim()) return {error:"Gemini 응답이 비어 있습니다."};
    return {text:text.trim(),sources:extractSrc(cand?.groundingMetadata)};
  }catch(e){
    return {error:e.message||"Gemini 호출 오류"};
  }
}

async function repairJSON({key,model,badText}){
  try{
    const prompt=`아래 텍스트를 올바른 JSON으로 변환하라.
설명문 없이 JSON만 출력하라.
반드시 {"topics":[...]} 구조여야 한다.
JSON 문자열 안의 줄바꿈은 \\n 으로 이스케이프하라.

텍스트:
${badText}`;
    const payload={
      contents:[{role:"user",parts:[{text:prompt}]}],
      generationConfig:{temperature:0.1,maxOutputTokens:10000,response_mime_type:"application/json"}
    };
    let r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
    });
    let data=await r.json();
    if(!r.ok){
      delete payload.generationConfig.response_mime_type;
      r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
      });
      data=await r.json();
      if(!r.ok) return {error:data.error?.message||"JSON 보정 API 오류"};
    }
    const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n")||"";
    if(!text.trim()) return {error:"JSON 보정 응답이 비어 있습니다."};
    return {text:text.trim()};
  }catch(e){
    return {error:e.message||"JSON 보정 호출 오류"};
  }
}

function isRetryable(msg){
  const s=String(msg||"").toLowerCase();
  return s.includes("google_search")||s.includes("tool")||s.includes("grounding")||s.includes("not supported")||s.includes("search")||s.includes("response_mime_type")||s.includes("json");
}

function parseJSON(text){
  const raw=String(text||"").trim();
  let c=raw.replace(/```json/gi,"").replace(/```/g,"").trim();

  try{return JSON.parse(c)}catch(e){}

  // ```json 이외 설명문이 섞인 경우 첫 { ~ 마지막 } 추출
  let s=c.indexOf("{"), e=c.lastIndexOf("}");
  if(s>=0 && e>s){
    const slice=c.slice(s,e+1);
    try{return JSON.parse(slice)}catch(err){}
  }

  // 제어문자 제거 후 재시도
  c=c.replace(/[\u0000-\u001F]+/g, " ");
  try{return JSON.parse(c)}catch(e2){}

  s=c.indexOf("{"); e=c.lastIndexOf("}");
  if(s>=0 && e>s) return JSON.parse(c.slice(s,e+1));

  throw new Error("JSON 파싱 실패 — Gemini 응답에 JSON 외 문장 또는 잘린 JSON이 포함되었습니다.");
}

function tokens(s){
  return new Set(String(s||"").replace(/[^\w가-힣\s]/g," ").split(/\s+/).filter(x=>x.length>1));
}
function sim(a,b){
  const A=tokens(a),B=tokens(b);
  const i=[...A].filter(x=>B.has(x)).length;
  const u=new Set([...A,...B]).size||1;
  return i/u;
}
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
