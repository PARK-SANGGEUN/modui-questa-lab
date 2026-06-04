
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(200).json(makeResponse(req.body||{}));
    const body=req.body||{};
    const mode=body.mode||"topics";
    const key=process.env.GEMINI_API_KEY||"";
    const models=[process.env.GEMINI_MODEL,"gemini-2.0-flash","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-1.5-flash-latest"].filter(Boolean);
    const p=profile(body);
    const db=body.localDB||{};
    if(mode==="topics"){
      if(key){
        const prompt=topicPrompt(p,db);
        const ai=await askJson(key,models,prompt);
        const topics=normalize(ai?.topics||[],p,db);
        if(topics.length>=5) return res.status(200).json({topics:topics.slice(0,5),engine:"db+engine"});
      }
      return res.status(200).json({topics:fallbackTopics(p,db),engine:"db"});
    }
    if(mode==="compare"){
      if(key){
        const txt=await askText(key,models,comparePrompt(p,body.selectedTopic||{},db));
        if(txt) return res.status(200).json({text:htmlCompare(txt),engine:"db+engine"});
      }
      return res.status(200).json({text:fallbackCompare(p,body.selectedTopic||{},db),engine:"db"});
    }
    if(mode==="report"){
      if(key){
        const txt=await askText(key,models,reportPrompt(p,body.selectedTopic||{},db));
        if(txt) return res.status(200).json({report:htmlReport(txt),engine:"db+engine"});
      }
      return res.status(200).json({report:fallbackReport(p,body.selectedTopic||{},db),engine:"db"});
    }
    return res.status(200).json(makeResponse(body));
  }catch(e){
    return res.status(200).json(makeResponse(req.body||{}));
  }
}
function makeResponse(body){
  const p=profile(body||{});
  const db=body.localDB||{};
  if(body.mode==="compare") return {text:fallbackCompare(p,body.selectedTopic||{},db),engine:"db-recovered"};
  if(body.mode==="report") return {report:fallbackReport(p,body.selectedTopic||{},db),engine:"db-recovered"};
  return {topics:fallbackTopics(p,db),engine:"db-recovered"};
}
function profile(b){
  return {
    level:b.level||"미선택",track:b.track||"",majorDetail:b.majorDetail||"",subjectGroup:b.subjectGroup||"",
    subject:b.subject||"",keyword:b.keyword||"",history:b.history||"",currentGrade:b.currentGrade||"1",currentSemester:b.currentSemester||"1"
  };
}
function dbText(db){
  const cases=(db.matchedCases||[]).slice(0,10).map((c,i)=>`${i+1}. ${c.university||""}/${c.major||""}/${c.subject||""}: ${c.topic||""} | ${c.method||""} | ${c.pattern||c.sourceStructure||""}`).join("\\n");
  const books=(db.relatedBooks||[]).slice(0,5).map((b,i)=>`${i+1}. ${b.title||""}: ${b.use||""}`).join("\\n");
  return `내부 DB 사례:\\n${cases||"조건에 맞는 사례를 계열 기준으로 확장"}\\n도서 관점:\\n${books||"교과서, 공공자료, 전공 입문자료 활용"}`;
}
function topicPrompt(p,db){
  return `학생부종합전형 탐구 주제 5개를 생성한다. 템플릿 제목 금지. JSON만 출력.
학생:${JSON.stringify(p)}
${dbText(db)}
규칙: 5개는 탐구방법·질문·산출물이 모두 달라야 한다. 내부 DB 구조 근거, 2022 과목 근거, 세부학과 적합성, 6단계 로드맵 포함.
스키마:
{"topics":[{"type":"","title":"","question":"","summary":"","majorFit":"","curriculumFit":"","sourceCase":"","duplicateCheck":"","differentiator":"","tags":[""],"evidence":{"subject":"","book":"","admission":""},"roadmap":[{"title":"","detail":"","tools":[""]}]}]}`;
}
function comparePrompt(p,t,db){
  return `별표 없이 상담 편지처럼 설명한다. 중요한 문장은 <span class="focus-highlight">강조</span>. 내부 DB, 2022 과목, 세부학과, 대학급 근거로 비교한다.
학생:${JSON.stringify(p)}
주제:${JSON.stringify(t)}
${dbText(db)}
포함: 강점, 부족한 점, 보완, 2022 과목 연결, 학기별 로드맵, 교과·창체·진로·세특 연결.`;
}
function reportPrompt(p,t,db){
  return `HTML 보고서 작성. 각 섹션은 <div class="report-section"><h3>제목</h3><p>내용</p></div>. 별표 금지. 중요한 문장은 <span class="focus-highlight">강조</span>.
학생:${JSON.stringify(p)}
주제:${JSON.stringify(t)}
${dbText(db)}
포함: 동기, 질문 진화, 2022 과목 연결, 근거 자료, 설계, 예비수정, 본탐구, 결과, 한계, 학기별 로드맵, 세특 예시, 면접 답변.`;
}
async function askJson(key,models,prompt){
  for(const m of models){
    for(const opt of [true,false]){
      const r=await call(key,m,prompt,opt,true);
      const obj=parseLoose(r);
      if(obj?.topics) return obj;
    }
  }
  return null;
}
async function askText(key,models,prompt){
  for(const m of models){
    for(const opt of [true,false]){
      const t=await call(key,m,prompt,opt,false);
      if(t && typeof t==="string" && t.trim()) return t.trim();
    }
  }
  return "";
}
async function call(key,model,prompt,search,jsonMode){
  try{
    const payload={contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.7,topP:0.9,maxOutputTokens:9000}};
    if(jsonMode) payload.generationConfig.response_mime_type="application/json";
    if(search) payload.tools=[{google_search:{}}];
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json();
    if(!r.ok) return "";
    return d?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\\n")||"";
  }catch(e){return "";}
}
function parseLoose(txt){
  if(!txt) return null;
  let c=String(txt).replace(/```json/gi,"").replace(/```/g,"").trim();
  try{return JSON.parse(c)}catch(e){}
  const s=c.indexOf("{"), e=c.lastIndexOf("}");
  if(s>=0&&e>s){try{return JSON.parse(c.slice(s,e+1))}catch(x){}}
  c=c.replace(/[\\u0000-\\u001F]+/g," ");
  try{return JSON.parse(c)}catch(e){}
  return null;
}
function normalize(list,p,db){
  const out=[];
  for(const x of list){
    const t=fill(x,p,db,out.length);
    if(bad(t.title)) continue;
    if(out.some(o=>sim(o.title+" "+o.question,t.title+" "+t.question)>0.32)) continue;
    out.push(t); if(out.length>=5) break;
  }
  for(const f of fallbackTopics(p,db)){ if(out.length>=5) break; if(!out.some(o=>sim(o.title,f.title)>0.32)) out.push(f); }
  return out;
}
function fill(x,p,db,i){
  const c=(db.matchedCases||[])[i]||{};
  return {
    type:x.type||types()[i%5], title:x.title||title(p,c,i), question:x.question||question(p,c,i),
    summary:x.summary||`${p.subject} 개념을 ${p.majorDetail}의 실제 문제와 연결해 자료를 수집하고 산출물로 정리합니다.`,
    majorFit:x.majorFit||`${p.majorDetail}에서 필요한 전공 기초소양과 문제해결력을 보여줍니다.`,
    curriculumFit:x.curriculumFit||`${p.subject}의 개념을 분석 기준으로 사용합니다.`,
    sourceCase:x.sourceCase||`내부 DB의 ${c.university||"대학"} ${c.major||p.majorDetail} 사례 구조를 응용했습니다.`,
    duplicateCheck:x.duplicateCheck||"탐구방법과 산출물이 다른 추천과 겹치지 않게 분리했습니다.",
    differentiator:x.differentiator||"실제 산출물과 수정 과정이 남습니다.",
    tags:Array.isArray(x.tags)?x.tags.slice(0,4):[p.subject,p.majorDetail],
    evidence:x.evidence||{subject:`${p.subject} 개념 연결`,book:"도서와 공공자료로 근거 보완",admission:`${p.level} 평가 관점 반영`},
    roadmap:Array.isArray(x.roadmap)&&x.roadmap.length?x.roadmap:roadmap(p,c)
  };
}
function fallbackTopics(p,db){
  return types().map((ty,i)=>{
    const c=(db.matchedCases||[])[i]||{};
    return fill({type:ty,title:title(p,c,i),question:question(p,c,i)},p,db,i);
  });
}
function types(){return ["데이터 분석형","실험 설계형","정책·윤리 비교형","문헌·비평형","제작·구현형"];}
function title(p,c,i){
  const k=p.keyword||c.keyword||"전공 관심";
  const arr=[
    `${k} 판단이 달라지는 조건을 ${p.subject} 자료로 검증하기`,
    `${p.majorDetail} 관점에서 본 ${k} 문제의 변수와 한계 분석`,
    `${p.subject} 개념으로 설계하는 ${k} 개선 프로토타입`,
    `${k} 사례를 비교해 만든 ${p.majorDetail} 진로형 판단 기준`,
    `${p.subject} 수업 질문에서 출발한 ${k} 데이터 해석 보고서`
  ];
  return arr[i%arr.length];
}
function question(p,c,i){
  const k=p.keyword||c.keyword||"이 현상";
  return [
    `${k}는 어떤 조건에서 다르게 나타나며 이를 ${p.subject} 개념으로 설명할 수 있을까?`,
    `${k} 문제를 판단할 때 가장 큰 영향을 주는 변수는 무엇일까?`,
    `${p.subject} 개념을 활용하면 ${k} 문제의 한계를 어떻게 더 정확히 볼 수 있을까?`,
    `${k}에 대한 기존 설명은 실제 자료와 얼마나 일치할까?`,
    `${k}를 개선하기 위한 작은 산출물을 만들면 어떤 기준으로 효과를 확인할 수 있을까?`
  ][i%5];
}
function roadmap(p,c){
  const sem=semesters(p.currentGrade,p.currentSemester);
  return [
    {title:"질문 좁히기",detail:`${p.subject} 수업에서 생긴 의문을 세 문장으로 정리하고 ${p.majorDetail}와 가장 가까운 질문을 고릅니다.`,tools:["교과서","질문 기록표"]},
    {title:"근거 자료 찾기",detail:"내부 DB의 유사 사례 구조를 참고하되 제목은 따라 하지 않고 자료 수집 구조만 가져옵니다.",tools:["내부 사례 DB","도서","공공자료"]},
    {title:"예비 실행",detail:"작은 표본으로 먼저 실행하고 문항이나 측정 기준의 문제를 기록합니다.",tools:["예비 설문","실험 기록표"]},
    {title:"본 탐구",detail:"수정한 기준으로 본 탐구를 진행하고 표, 그래프, 활동지, 프로토타입 중 하나를 산출물로 남깁니다.",tools:["분석표","그래프","산출물"]},
    {title:"해석과 한계",detail:`결과를 ${p.subject} 개념으로 해석하고 표본, 방법, 자료의 한계를 정리합니다.`,tools:["해석표","한계 분석"]},
    {title:"학기별 확장",detail:`${sem.join(" → ")} 흐름으로 교과 세특, 창체, 진로활동, 독서, 발표를 연결합니다.`,tools:["세특 메모","창체 기록","진로활동 계획"]}
  ];
}
function semesters(g,s){
  const a=[]; g=parseInt(g||1); s=parseInt(s||1);
  for(let grade=g;grade<=3;grade++){for(let sem=(grade===g?s:1);sem<=2;sem++)a.push(`고${grade}-${sem}`);}
  return a;
}
function fallbackCompare(p,t,db){
  const sem=semesters(p.currentGrade,p.currentSemester);
  return `<div class="evidence-box"><h3>상담형 분석 결과</h3><p>이 주제는 ${p.subject}에서 배운 개념을 ${p.majorDetail}의 실제 문제와 연결하려는 흐름이 분명합니다. <span class="focus-highlight">좋은 점은 교과 개념이 실제 산출물로 이어질 수 있다는 점</span>입니다.</p></div><div class="evidence-box"><h3>근거 있는 비교</h3><p>내부 DB의 유사 사례들은 교과 질문에서 출발해 자료 수집, 예비 실행, 기준 수정, 보고서 정리로 이어지는 구조를 보입니다. 이 주제도 같은 성장 구조를 따르되 내용은 새롭게 구성되어 중복 위험을 줄였습니다.</p></div><div class="evidence-box"><h3>보완 방향</h3><p>${p.majorDetail} 전공 적합성을 더 분명히 하려면 대상, 변수, 측정 기준을 구체화해야 합니다. 이 부분이 명확해지면 면접에서 탐구 이유와 과정 설명이 쉬워집니다.</p></div><div class="evidence-box"><h3>학기별 성장 로드맵</h3><p>${sem.map((x,i)=>`${x}에는 ${["질문 정리와 예비 조사","자료 수집과 작은 실험","본 탐구와 분석","발표와 세특 정리","후속 탐구와 면접 대비"][Math.min(i,4)]}를 진행합니다.`).join(" ")}</p></div>`;
}
function fallbackReport(p,t,db){
  return `<div class="report-section"><h3>탐구 주제</h3><p>${t.title||title(p,{},0)}</p></div><div class="report-section"><h3>탐구 동기</h3><p>${p.subject} 수업에서 배운 개념이 ${p.majorDetail} 문제를 설명할 수 있는지 궁금해졌습니다. <span class="focus-highlight">단순 개념 적용이 아니라 실제 자료와 산출물로 확인하는 것</span>을 목표로 삼았습니다.</p></div><div class="report-section"><h3>질문의 진화</h3><p>처음에는 ${p.keyword||"관심 주제"}가 왜 중요한지 묻는 수준이었지만, 이후 대상과 조건을 좁혀 어떤 변수에 따라 결과가 달라지는지 확인하는 질문으로 바꾸었습니다.</p></div><div class="report-section"><h3>2022 개정 과목 연결</h3><p>${p.subject}의 핵심 개념을 분석 기준으로 사용했습니다. 이 개념은 탐구 결과를 단순히 나열하는 것이 아니라 왜 그런 결과가 나왔는지 설명하는 도구가 되었습니다.</p></div><div class="report-section"><h3>학기별 성장 로드맵</h3><p>${semesters(p.currentGrade,p.currentSemester).map((x,i)=>`${x}: ${["교과 질문 정리와 예비 조사","창체·진로활동에서 자료 수집과 인터뷰","본 탐구 수행과 분석 보고서 작성","발표와 세특 정리, 후속 질문 설계","면접 답변 정리와 전공 심화 독서"][Math.min(i,4)]}`).join("<br>")}</p></div><div class="report-section"><h3>세특 예시</h3><p>${p.subject} 개념을 ${p.majorDetail} 관련 문제와 연결하여 탐구 질문을 설정하고, 자료 수집과 예비 실행을 거쳐 분석 기준을 수정함. 결과 해석 과정에서 한계를 인식하고 후속 탐구 방향을 제시하는 등 자기주도적 탐구 태도가 돋보임.</p></div>`;
}
function htmlCompare(t){return t.includes("evidence-box")?t:`<div class="evidence-box"><h3>분석 결과</h3><p>${String(t).replace(/\*\*/g,"").replace(/\n/g,"<br>")}</p></div>`;}
function htmlReport(t){return t.includes("report-section")?t:`<div class="report-section"><h3>탐구 보고서</h3><p>${String(t).replace(/\*\*/g,"").replace(/\n/g,"<br>")}</p></div>`;}
function isBad(t){return bad(t);}
function bad(t){return /를\s*(실험형|데이터 분석형|윤리 토론형|모델링형|교육 적용형)으로\s*탐구하는/.test(t)||/맞춤 주제$/.test(t)||/에 대한 탐구$/.test(t)||/을 통한 탐구$/.test(t)||/방법 탐구$/.test(t);}
function tok(s){return new Set(String(s||"").replace(/[^\w가-힣\s]/g," ").split(/\s+/).filter(x=>x.length>1));}
function sim(a,b){const A=tok(a),B=tok(b);const i=[...A].filter(x=>B.has(x)).length;const u=new Set([...A,...B]).size||1;return i/u;}
