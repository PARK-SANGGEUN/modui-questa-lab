export default async function handler(req,res){
  // CORS 헤더 모든 응답에 추가
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');

  // OPTIONS 프리플라이트 즉시 응답
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const body=req.body||{};
  const key=process.env.GEMINI_API_KEY;
  if(!key) return res.status(500).json({error:"GEMINI_API_KEY 환경변수가 없습니다."});
  const modelList=buildModelList(process.env.GEMINI_MODEL);

  const p=`대학급: ${body.level||"미선택"}
계열: ${body.track||"미선택"}
세부학과: ${body.majorDetail||"미선택"}
2022 과목군: ${body.subjectGroup||"미선택"}
2022 개정 과목: ${body.subject||"미선택"}
관심 키워드: ${body.keyword||"없음"}
현재 학년: ${body.currentGrade||"1"}
현재 학기: ${body.currentSemester||"1"}
기존 활동/독서: ${body.history||"없음"}`;

  const localDB=body.localDB||{};
  const dbCtx=buildDBContext(localDB);
  const SYSTEM=buildSystem();

  let prompt="",jsonMode=true;
  if(body.mode==="topics"){
    prompt=buildTopicsPrompt(SYSTEM,p,dbCtx,body);
  } else if(body.mode==="compare"){
    jsonMode=false;
    prompt=buildComparePrompt(SYSTEM,p,dbCtx,body.selectedTopic||{});
  } else if(body.mode==="report"){
    jsonMode=false;
    prompt=buildReportPrompt(SYSTEM,p,dbCtx,body.selectedTopic||{},body);
  } else if(body.mode==="transform"){
    prompt=buildTransformPrompt(SYSTEM,p,dbCtx,body);
    // transform도 topics와 같은 JSON 구조 사용
  } else {
    return res.status(400).json({error:"지원하지 않는 mode"});
  }

  try{
    let result=await callGeminiWithFallback({key,modelList,prompt,useSearch:true,mode:body.mode,jsonMode});
    if(result.error&&isRetryable(result.error))
      result=await callGeminiWithFallback({key,modelList,prompt,useSearch:false,mode:body.mode,jsonMode});
    if(result.error&&String(result.error).includes("response_mime_type"))
      result=await callGeminiWithFallback({key,modelList,prompt,useSearch:false,mode:body.mode,jsonMode:false});
    if(result.error) return res.status(500).json({error:result.error});

    if(!jsonMode){
      const k=body.mode==="report"?"report":"text";
      return res.status(200).json({[k]:result.text,sources:result.sources||[],model:result.model});
    }
    let parsed;
    try{ parsed=parseJSON(result.text); }
    catch(e){
      const rep=await repairJSON({key,modelList,badText:result.text});
      if(rep.error) return res.status(500).json({error:"JSON 보정 실패: "+rep.error});
      parsed=parseJSON(rep.text);
    }
    const topics=dedupe(parsed.topics||[]);
    if(topics.length<5) return res.status(500).json({error:"주제가 5개 미만입니다. 다시 시도해 주세요."});
    return res.status(200).json({topics:topics.slice(0,5),sources:result.sources||[],model:result.model});
  }catch(e){
    return res.status(500).json({error:e.message||"생성 중 오류"});
  }
}

function buildSystem(){
return `[QUESTA OS 탐구 설계 엔진 · 시스템 지침]

너는 대한민국 최고의 학생부종합전형 탐구 설계 전문가다.
내부 사례 DB와 2022 개정 교육과정, 대학별 가이드북 구조를 완전히 숙지하고 있다.

[출력 원칙]
- 별표(**) 나열, 마크다운 목록 중심 답변 금지
- 학생에게 상담하듯, 편지처럼 쉽게 설명한다
- 모든 판단에는 '왜 그런지' 근거를 반드시 붙인다
- 근거는 DB 사례 구조 / 2022 과목 개념 / 세부학과 요구역량 / 대학급 평가 관점 중 2개 이상
- 중요 문장: <span class="focus-highlight">강조 문장</span>
- 박스: <div class="evidence-box"><h3>제목</h3><p>내용</p></div>
- 보고서 섹션: <div class="report-section"><h3>제목</h3><p>내용</p></div>
- 현재 학년·학기 → 3학년 2학기까지 학기별 성장 로드맵 필수
- 로드맵: 교과 세특·창체·진로활동·독서·실험/설문/데이터/제작·발표/면접 연결 포함

[절대 금지]
- "~형으로 탐구하는 맞춤 주제" 같은 템플릿 제목
- 5개 주제 문장구조·질문방식·산출물 반복
- 세부학과·2022 과목이 반영 안 된 일반론
- 가짜 책 제목·가짜 대학 사례 단정

[반드시 수행]
- 내부 사례 DB 구조 참고, 제목·문장은 새로 만들기
- 5개 추천은 탐구방법·질문세계·산출물이 완전히 달라야 함
- 각 주제는 세부학과와 2022 개정 과목에 직접 매칭
- 로드맵 6단계 이상, 각 단계에 구체적 행동·도구·산출물·수정 흔적 포함`;
}

function buildDBContext(localDB){
  const cases=(localDB.matchedCases||[]).slice(0,20);
  const books=(localDB.relatedBooks||[]).slice(0,6);
  const methods=(localDB.methodPool||[]);

  const caseLines=cases.map((c,i)=>{
    const outputs=Array.isArray(c.outputs)?c.outputs.join(", "):"-";
    const focus=Array.isArray(c.focus)?c.focus.join(" · "):"-";
    const concepts=Array.isArray(c.concepts)?c.concepts.join(", "):"-";
    return `${i+1}. [${c.level||""}/${c.u||""}/${c.m||""}] 교과:${c.subject||"-"} 키워드:${c.k||"-"}\n   주제: ${c.t||"-"}\n   방법: ${c.method||"-"} | 산출물: ${outputs}\n   핵심역량: ${focus} | 개념: ${concepts}\n   구조: ${c.sourceStructure||"-"}`;
  }).join("\n\n");

  const methodLines=methods.map(m=>{
    const steps=Array.isArray(m.steps)?m.steps.join(" → "):"-";
    const outputs=Array.isArray(m.outputs)?m.outputs.join(", "):"-";
    return `▸ ${m.name||m.id}: ${steps}\n  산출물: ${outputs}`;
  }).join("\n");

  const bookLines=books.map(b=>`▸ 《${b.title}》(${b.author||""}) — ${b.use||""}`).join("\n");

  return `[내부 DB 매칭 사례 ${cases.length}건 — 구조만 참고, 복제 금지]
${caseLines||"(매칭 없음)"}

[탐구방법 DB 10종 전체]
${methodLines}

[관련 추천 도서]
${bookLines||"(없음)"}

전체 DB: ${localDB.caseCount||0}건`;
}

function buildTopicsPrompt(SYSTEM,p,dbCtx,body){
  const sems=buildSemesterList(body.currentGrade||"1",body.currentSemester||"1").join(", ");
return `${SYSTEM}

[학생 정보]
${p}
설계 기간: ${sems}

[내부 DB 참고자료]
${dbCtx}

[2022 개정 과목별 탐구 방향 — 세밀 가이드]

수학 계열:
- 공통수학1·2: 함수·식·그래프 → 실제 현상 해석, 비례관계 모델링
- 대수: 지수·로그·수열 → 성장/감쇠 분석, 점화식 활용
- 미적분Ⅰ·Ⅱ: 극한·미분·적분 → 변화율 분석, 최적화, 넓이·부피 계산
- 확률과 통계: 표본설계·가설검정·조건부확률 → 설문 분석, t검정, 카이제곱
- 기하: 이차곡선·공간도형·벡터 → 궤도 설계, 구조 분석, 3D 시각화
- 경제 수학: 함수·수열·최적화 → 비용편익, 의사결정, 금융 모델
- 인공지능 수학: 벡터·행렬·분류 → 알고리즘 구현, 편향 분석

영어 계열:
- 영어 독해와 작문: 담론 분석·논증 구조·텍스트 비교
- 미디어 영어: 프레이밍·광고언어·뉴스 담론 비교
- 영미 문학 읽기: 작품 비평·서사 구조·문화적 맥락

사회 계열:
- 경제: 수요공급·시장실패·정책효과 → 공공데이터 분석
- 정치·법과 사회: 제도 비교·판례 분석·정책 쟁점
- 사회·문화: 사회 현상 통계·설문 설계·인터뷰
- 사회문제 탐구: 현장조사·지역 데이터·정책 제안
- 윤리와 사상: 논증 구조·사례 비교·윤리 판단 기준표

과학 계열:
- 물리학·역학과 에너지·전자기와 양자: 변인통제·반복측정·오차분석·수식 유도
- 화학·화학 반응의 세계: 실험설계·농도/온도 변인·분광 분석·TLC
- 생명과학·세포와 물질대사: 분자생물학 기초·통계분석·문헌 메타분석
- 지구과학·지구시스템과학: GIS·기상데이터·공공 관측 자료
- 과학탐구실험: 정밀 측정·오차 보고서·반복 실험 설계
- 기후변화와 환경생태: 탄소발자국 측정·환경 데이터·정책 비교

정보·공학 계열:
- 정보·데이터 과학: 파이썬 데이터 분석·시각화·공공 API 활용
- 인공지능 기초: 모델 구현·성능 평가·편향 측정·XAI
- 소프트웨어와 생활: 알고리즘 설계·사용성 테스트·프로토타입
- 로봇과 공학세계: 하드웨어 제작·센서 데이터·PID 제어

예술·체육:
- 미술 창작·영상 제작·연극: 기획서·제작일지·비평문·포트폴리오
- 스포츠 과학·운동과 건강: 신체 데이터·훈련 효과 측정·운동처방 모델

[탐구방법 10종 세밀 가이드 — 고등학생 실행 수준]

① 데이터 분석형
수행절차: 공공데이터(KOSIS/e-나라지표/교육통계) 수집 → 엑셀/파이썬 상관분석·회귀분석 → 시각화 → 해석
도구: 엑셀 CORREL·LINEST, 파이썬 pandas/matplotlib/seaborn, SPSS 기초
산출물: 데이터 수집 기록지, 분석 그래프, 상관계수 해석표, 한계점 보고서
주의: 표본 대표성, 교란변수 통제, 인과관계 오류 회피, 출처 명시

② 실험·측정형
수행절차: 가설 설정 → 변인(독립/종속/통제) 정의 → 예비실험 → 본실험 3회 반복 → 오차분석 → 결론
도구: 실험 기록지, 표준편차 계산, 오차분석표, 측정 장비 목록
산출물: 실험 프로토콜, 원자료표, 그래프, 오차율 계산, 반성 및 개선 방향
주의: 변인 통제 명확히, 반복 횟수 명시, 측정 도구 한계 서술, 예비실험 필수

③ 설문·현장조사형
수행절차: 리커트 5점 척도 문항 설계(20문항 이상) → 예비조사(10명) → 문항 수정 → 본조사(50~150명) → 통계 분석
도구: 구글 폼, SPSS 기초(평균·표준편차·t검정·카이제곱), 엑셀 피벗
산출물: 설문 문항지, 코딩북, 기술통계표, 집단 간 비교 그래프, 해석 보고서
주의: 표집 방법 명시, 편의표본 한계 인정, 무응답 처리 방법 서술

④ 모델링·시뮬레이션형
수행절차: 현상 단순화 → 변수 정의 → 수리/컴퓨터 모델 구성 → 시뮬레이션 → 민감도 분석 → 실제 데이터 검증
도구: 파이썬(SciPy/NumPy), GeoGebra, 스프레드시트 시뮬레이션
산출물: 모델 수식, 시뮬레이션 결과 그래프, 민감도 분석표, 실제값 비교
주의: 가정 명시, 단순화 한계 인식, 실제 현상과 비교 검증 필수

⑤ 정책·제도 비교형
수행절차: 비교 대상 2~4개국/지역 선정 → 평가 기준 설정 → 정량·정성 비교 → 이해관계자 분석 → 개선 제안
도구: 정부 보고서, OECD 통계, 법령 DB(국가법령정보센터), 신문 기사
산출물: 비교 분석표, 쟁점 지도, 이해관계자 매핑, 개선 제안서
주의: 비교 기준 사전 설정, 맥락 차이 인정, 단순화 오류 회피

⑥ 문헌·비평형
수행절차: 핵심 자료 3~5편 선정 → 관점 추출 → 비교 기준 설정 → 비평문 작성 → 후속 질문 도출
도구: RISS·Google Scholar, 독서 기록지, 개념 지도 작성
산출물: 비교 독서표, 관점 요약표, 비평문(800~1500자), 개념 지도
주의: 요약과 비평 구분, 자신의 관점 명확히, 출처 정확히 기재

⑦ 제작·구현형
수행절차: 문제 정의 → 요구사항 분석 → 설계도/기획서 → 시제품 제작 → 사용자 테스트(5~10명) → 반복 개선
도구: 아두이노, 앱인벤터, 피그마, 파이썬/JS 코딩, 3D 프린터
산출물: 기획서, 설계도, 프로토타입 사진/영상, 테스트 기록지, 개선 일지
주의: 반복 개선 과정 기록, 사용자 피드백 구체적으로, 기술적 한계 명시

⑧ 포트폴리오·작품분석형
수행절차: 작품 의도 설정 → 레퍼런스 분석(5작품 이상) → 제작 실험 → 피드백 반영 → 최종 비평
도구: 제작일지, 비평 기준표, 작품 기획서, 레퍼런스 분석표
산출물: 작품기획서, 단계별 제작일지, 레퍼런스 분석표, 최종 비평문
주의: 의도-과정-결과 연결, 자기 비평 솔직하게, 타 작품과 차별화 명시

⑨ 교육 적용형
수행절차: 학습자 분석 → 교수학습 설계 → 소규모 미니수업(5~15명) → 사전·사후 검사 → 오개념 분석
도구: 활동지, 사전·사후 검사지, 관찰 기록지, 리커트 반응 설문
산출물: 수업 설계서, 활동지, 오개념 분석표, 수업 반성 일지
주의: 학습자 동의 필요, 오개념 분석 구체적으로, 교직 인성 반영

⑩ 윤리·쟁점 토론형
수행절차: 쟁점 선정 → 윤리 이론(공리주의/의무론/덕윤리) 연결 → 사례 비교 → 입장 정리 → 판단 기준 제시
도구: 쟁점 비교표, 논증 구조도, 윤리 판단 기준표
산출물: 쟁점 비교표, 찬반 논증문, 윤리 판단 기준표, 개인 입장문
주의: 양측 논거 균형, 자신의 입장 근거 명확히, 사례 출처 정확히

[대학급별 핵심 요구]
R1 서울대·KAIST·POSTECH: 좁고 깊은 탐구, 질문 독창성, 오차·한계 인식, 자기주도 심화
R2 최상위 의약학: 변인통제, 임상 판단, 통계 신뢰성, 생명윤리
R3 연세대·고려대·성균관대·서강대: 학업 수월성, 동기→과정→발견→결론 스토리, 공동체 기여
R4 한양대·중앙대·경희대·시립대: 전공적합성, 정량 데이터, 면접 연계
R5 이화여대·건국대·동국대·홍익대: 독서 심화, 비교 분석, 성장 서사
R6 국민대·숭실대·세종대·단국대: 실제 수행, 자료 기반, 진로 일관성
R7 지방거점국립대: 지역사회 연계, 과학적 분석, 전공 기초소양
R9 교대·사범대: 학습자 반응 분석, 오개념 분석표, 수업 적용
R10·R11 예체능: 포트폴리오, 작품 기획·제작, 비평 능력

구체적인 탐구 주제 5개를 추천하라.
각 주제는 탐구방법·산출물·질문 방향이 완전히 달라야 한다.
주제명은 탐구 대상·변수·범위가 명확하게 드러나야 한다.
로드맵은 6단계 이상, 각 단계에 실제 행동·도구·산출물·수정 흔적을 포함하라.

반드시 순수 JSON만 출력한다. 마크다운·코드블록·설명문·주석 절대 금지.
JSON 문자열 안의 줄바꿈은 \\n으로 이스케이프한다. 마지막 쉼표 금지.

{
 "topics":[
  {
   "type":"탐구유형(방법명 정확히)",
   "title":"구체적이고 중복되지 않는 제목(변수·대상·범위 포함)",
   "question":"학생이 실제로 품은 핵심 질문(의문문)",
   "summary":"고등학생이 실제 수행할 수 있는 구체적 탐구 설명(3~4문장)",
   "majorFit":"세부학과와 맞는 이유(역량 연결)",
   "curriculumFit":"2022 개정 과목과 맞는 개념 2~3개, 세특 연결 방향",
   "sourceCase":"참고한 사례/가이드북 구조 설명(출처 단정 금지)",
   "duplicateCheck":"다른 4개 주제와 겹치지 않는 차별 지점",
   "differentiator":"이 주제만의 독창성·차별화 포인트",
   "tags":["키워드1","키워드2","키워드3"],
   "evidence":{
    "subject":"교과 근거 — 과목명·단원·핵심개념 명시",
    "book":"관련 도서/논문/데이터 연결 근거",
    "admission":"대학급 평가 관점 포인트"
   },
   "methodDetail":{
    "name":"탐구방법명",
    "steps":["1단계: 구체적 행동","2단계","3단계","4단계","5단계"],
    "tools":["도구1","도구2","도구3"],
    "outputs":["산출물1","산출물2","산출물3"],
    "cautions":["주의사항1","주의사항2"]
   },
   "roadmap":[
    {
     "title":"단계명",
     "semester":"고1-1 등",
     "detail":"실제 행동·근거·산출물·수정 흔적(3~4문장)",
     "activities":["교과 세특 연결","창체/진로 활동","탐구 수행 내용"],
     "tools":["사용 도구","방법","자료"]
    }
   ]
  }
 ]
}`;
}

function buildComparePrompt(SYSTEM,p,dbCtx,topic){
return `${SYSTEM}

[학생 정보]
${p}

[내부 DB 참고]
${dbCtx}

[선택한 탐구 주제]
제목: ${topic.title||""}
핵심 질문: ${topic.question||""}
탐구 유형: ${topic.type||""}
교과 연결: ${topic.curriculumFit||""}
방법 세부: ${JSON.stringify(topic.methodDetail||{})}

실제 대학 가이드북과 합격사례 구조를 기준으로 이 탐구를 평가하라.
별표 나열 금지. 상담 편지형 문단으로 작성하라.

<div class="evidence-box"><h3>① 내부 DB 유사 사례 비교</h3><p>가장 유사한 구조의 내부 DB 사례 2~3개를 제시하고, 이 주제가 어떻게 다른지 설명하라.</p></div>

<div class="evidence-box"><h3>② 이 주제의 강점</h3><p>선택한 대학급과 학과 기준으로, 이 탐구가 돋보이는 이유를 구체적으로 설명하라.</p></div>

<div class="evidence-box"><h3>③ 보완이 필요한 부분과 구체적 개선 방향</h3><p>현재 설계에서 부족한 부분을 지적하고, 어떻게 강화할지 단계적으로 제시하라.</p></div>

<div class="evidence-box"><h3>④ 탐구방법 세밀화 — 고등학생 실행 수준</h3><p>선택된 탐구방법으로 실제 수행하는 구체적 절차, 주의할 점, 자주 실수하는 부분을 안내하라.</p></div>

<div class="evidence-box"><h3>⑤ 2022 개정 과목 연계 강화</h3><p>현재 연결된 과목 외 추가 연결 가능한 2022 개정 과목과 개념을 제시하라.</p></div>

<div class="evidence-box"><h3>⑥ 세부학과 기준 심화 방향</h3><p>해당 학과 관점에서 이 탐구를 더 깊이 있게 만드는 방법을 구체적으로 제시하라.</p></div>

<div class="evidence-box"><h3>⑦ 중복 위험 분석 및 차별화 전략</h3><p>이 주제가 흔히 제출되는 탐구와 겹칠 위험을 분석하고, 차별화 전략을 제시하라.</p></div>

<div class="evidence-box"><h3>⑧ 산출물 강화 방안</h3><p>더 설득력 있는 산출물 3가지를 제안하고, 각각 어떻게 만드는지 설명하라.</p></div>

<div class="evidence-box"><h3>⑨ 학기별 성장 로드맵</h3><p>현재 학기부터 고3-2학기까지 — 어떤 교과 세특에 반영할지, 창체·진로활동 연결, 방학 산출물을 학기별로 구체적으로 작성하라.</p></div>

<div class="evidence-box"><h3>⑩ 면접 대비 핵심 질문과 답변 소재</h3><p>이 탐구 기반 면접 예상 질문 3가지와 답변 방향을 제시하라.</p></div>`;
}

function buildReportPrompt(SYSTEM,p,dbCtx,topic,body){
  const sems=buildSemesterList(body.currentGrade||"1",body.currentSemester||"1").join(", ");
  const mDetail=topic.methodDetail||{};
  const steps=Array.isArray(mDetail.steps)?mDetail.steps.join(" → "):"-";
  const tools=Array.isArray(mDetail.tools)?mDetail.tools.join(", "):"-";
  const outputs=Array.isArray(mDetail.outputs)?mDetail.outputs.join(", "):"-";
  const cautions=Array.isArray(mDetail.cautions)?mDetail.cautions.join(" / "):"-";
return `${SYSTEM}

[학생 정보]
${p}
설계 기간: ${sems}

[내부 DB 참고]
${dbCtx}

[선택한 탐구 주제]
제목: ${topic.title||""}
핵심 질문: ${topic.question||""}
탐구 개요: ${topic.summary||""}
탐구 유형: ${topic.type||""}
교과 연결: ${topic.curriculumFit||""}
학과 적합성: ${topic.majorFit||""}
탐구방법 절차: ${steps}
사용 도구: ${tools}
산출물: ${outputs}
주의사항: ${cautions}

완성형 탐구보고서 초안을 작성하라.
학생이 실제 탐구 후 정리한 느낌으로, 과장 없이 작성한다.
중요 문장은 <span class="focus-highlight">강조</span>한다.
각 섹션은 <div class="report-section"><h3>섹션명</h3><p>내용</p></div> 형식으로 작성한다.
별표 나열 금지. 문단형으로 서술한다.

아래 섹션을 순서대로 빠짐없이 작성하라:

<div class="report-section"><h3>📋 탐구 기본 정보</h3>
<p>탐구 주제 / 탐구 기간 / 탐구 방법 / 연계 교과 / 목표 학과·대학급을 표 형식으로 정리하라.</p></div>

<div class="report-section"><h3>1. 탐구 동기 및 문제 인식</h3>
<p>수업·독서·일상에서 어떤 계기로 이 질문에 이르게 됐는지 구체적으로 서술하라. '왜 이것이 문제인가'를 설득력 있게 작성하라.</p></div>

<div class="report-section"><h3>2. 핵심 질문의 진화</h3>
<p>처음 질문이 어떻게 구체화·심화됐는지 서술하라. 최종 탐구 질문: <span class="focus-highlight">${topic.question||""}</span></p></div>

<div class="report-section"><h3>3. 이론적 배경 및 2022 개정 교과 개념 연결</h3>
<p>${topic.curriculumFit||"해당 교과"}과 연결되는 핵심 개념을 설명하고, 탐구 설계에 어떻게 적용됐는지 서술하라.</p></div>

<div class="report-section"><h3>4. 참고 자료 및 선행 연구 검토</h3>
<p>관련 도서·논문·데이터 출처를 제시하고, 각 자료가 탐구 설계에 어떤 영향을 줬는지 설명하라.</p></div>

<div class="report-section"><h3>5. 탐구 설계 및 방법 — 단계별 상세 절차</h3>
<p>탐구방법: ${topic.type||""}<br>
절차: ${steps}<br>
사용 도구: ${tools}<br>
주의사항: ${cautions}<br>
각 단계를 학생이 실제로 수행하는 방식으로 구체적으로 서술하라.</p></div>

<div class="report-section"><h3>6. 예비 탐구 및 설계 수정 과정</h3>
<p>예비 탐구에서 발견한 문제점과 본 탐구 전 설계를 어떻게 수정했는지 서술하라. 수정 전·후를 대비해 제시하라.</p></div>

<div class="report-section"><h3>7. 본 탐구 과정</h3>
<p>실제 수행한 탐구를 단계별로 서술하라. 예상치 못한 변수, 대응 방법, 중간 결과를 포함하라.</p></div>

<div class="report-section"><h3>8. 결과 및 해석</h3>
<p>산출물: ${outputs}<br>
결과를 서술하고, 처음 질문에 어떻게 답하는지 논리적으로 해석하라.</p></div>

<div class="report-section"><h3>9. 한계점 및 개선 방향</h3>
<p>이 탐구의 한계(표본 크기, 측정 오차, 변인 통제 등)를 솔직하게 서술하고, 개선 방향을 제시하라.</p></div>

<div class="report-section"><h3>10. 후속 탐구 방향</h3>
<p>이 탐구에서 해결 못한 질문, 더 심화할 수 있는 방향 2~3가지를 제시하라.</p></div>

<div class="report-section"><h3>11. 학기별 성장 로드맵 (${sems})</h3>
<p>각 학기별로: 어떤 교과 세특에 반영할지 / 창체·진로 활동 연결 / 방학 탐구 산출물을 구체적으로 작성하라.</p></div>

<div class="report-section"><h3>12. 세부학과 연결 및 진로 의미</h3>
<p>${body.majorDetail||"목표 학과"}에서 이 탐구가 어떤 역량을 보여주는지, 전공 공부와 어떻게 연결되는지 설명하라.</p></div>

<div class="report-section"><h3>13. 학생부 세특 예시 문장</h3>
<p>이 탐구를 세특에 기록할 때 사용할 수 있는 핵심 문장 2~3개를 제시하라. 교사가 실제 작성할 수 있는 형식으로.</p></div>

<div class="report-section"><h3>14. 면접 핵심 답변 소재</h3>
<p>이 탐구 기반 면접 예상 질문 3가지와 각 답변 방향을 제시하라.</p></div>`;
}

function buildSemesterList(g,s){
  const r=[];
  for(let grade=parseInt(g);grade<=3;grade++){
    for(let sem=(grade===parseInt(g)?parseInt(s):1);sem<=2;sem++){
      r.push(`고${grade}-${sem}`);
    }
  }
  return r;
}

function buildModelList(envModel){
  const c=[envModel,"gemini-2.0-flash","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-1.5-flash-latest","gemini-1.5-pro-latest"].filter(Boolean);
  return [...new Set(c)];
}

async function callGeminiWithFallback(args){
  const errors=[];
  for(const model of args.modelList){
    const result=await callGemini({...args,model});
    if(!result.error) return {...result,model};
    errors.push(`${model}: ${result.error}`);
    if(!isModelError(result.error)&&!isRetryable(result.error)) break;
  }
  return {error:errors.join(" | ")};
}

async function callGemini({key,model,prompt,useSearch,mode,jsonMode}){
  try{
    const payload={
      contents:[{role:"user",parts:[{text:prompt}]}],
      generationConfig:{
        temperature:mode==="topics"?0.88:0.72,
        topP:0.9,
        maxOutputTokens:mode==="topics"?12000:10000
      }
    };
    if(jsonMode) payload.generationConfig.response_mime_type="application/json";
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
  }catch(e){return {error:e.message||"Gemini 호출 오류"};}
}

async function repairJSON({key,modelList,badText}){
  const prompt=`아래 텍스트를 올바른 JSON으로 변환하라.\n설명문 없이 JSON만 출력하라.\n반드시 {"topics":[...]} 구조여야 한다.\nJSON 문자열 안의 줄바꿈은 \\n으로 이스케이프하라.\n\n텍스트:\n${badText}`;
  for(const model of modelList){
    try{
      const payload={contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:12000,response_mime_type:"application/json"}};
      let r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      let data=await r.json();
      if(!r.ok){
        delete payload.generationConfig.response_mime_type;
        r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        data=await r.json();
        if(!r.ok){if(isModelError(data.error?.message))continue;continue;}
      }
      const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n")||"";
      if(text.trim()) return {text:text.trim()};
    }catch(e){}
  }
  return {error:"JSON 보정 실패"};
}

function isRetryable(msg){const s=String(msg||"").toLowerCase();return s.includes("google_search")||s.includes("tool")||s.includes("grounding")||s.includes("not supported")||s.includes("search")||s.includes("response_mime_type")||s.includes("json");}
function isModelError(msg){const s=String(msg||"").toLowerCase();return s.includes("not found")||s.includes("not supported for generatecontent")||s.includes("model");}

function parseJSON(text){
  const raw=String(text||"").trim();
  let c=raw.replace(/```json/gi,"").replace(/```/g,"").trim();
  try{return JSON.parse(c)}catch(e){}
  let s=c.indexOf("{"),e=c.lastIndexOf("}");
  if(s>=0&&e>s){try{return JSON.parse(c.slice(s,e+1))}catch(err){}}
  c=c.replace(/[\u0000-\u001F]+/g," ");
  try{return JSON.parse(c)}catch(e2){}
  s=c.indexOf("{");e=c.lastIndexOf("}");
  if(s>=0&&e>s) return JSON.parse(c.slice(s,e+1));
  throw new Error("JSON 파싱 실패");
}

function tokens(s){return new Set(String(s||"").replace(/[^\w가-힣\s]/g," ").split(/\s+/).filter(x=>x.length>1));}
function sim(a,b){const A=tokens(a),B=tokens(b);const i=[...A].filter(x=>B.has(x)).length;const u=new Set([...A,...B]).size||1;return i/u;}
function badTemplate(t){const tt=String(t.title||"");return /를\s*(실험형|데이터 분석형|윤리 토론형|모델링형|교육 적용형)으로\s*탐구하는/.test(tt)||/맞춤 주제$/.test(tt)||/에 대한 탐구$/.test(tt)||/을 통한 탐구$/.test(tt)||/방법 탐구$/.test(tt);}
function dedupe(list){
  const out=[],types=new Set();
  for(const t of list){
    if(!t?.title||!t?.question)continue;
    if(badTemplate(t))continue;
    const key=`${t.title} ${t.question} ${t.type}`;
    if(out.some(o=>sim(key,`${o.title} ${o.question} ${o.type}`)>0.28))continue;
    if(types.has(t.type)&&out.length<4) t.type=t.type+" 심화";
    types.add(t.type);out.push(t);
    if(out.length===5)break;
  }
  return out;
}
function extractSrc(meta){return(meta?.groundingChunks||[]).map(c=>c.web).filter(Boolean).map(w=>({title:w.title||w.uri,uri:w.uri})).filter(x=>x.uri);}
function buildSemesterRoadmapText(sg,ss){
  const r=[];
  for(let g=parseInt(sg);g<=3;g++){for(let s=(g===parseInt(sg)?parseInt(ss):1);s<=2;s++){r.push(`고${g}-${s}`);}}
  return r;
}

/* ══════════ TRANSFORM PROMPT ══════════ */
function buildTransformPrompt(SYSTEM,p,dbCtx,body){
  const base=body.baseCase||{};
  const dir=body.transformDir||"full";
  const hint=body.transformHint||"";
  const sems=buildSemesterList(body.currentGrade||"1",body.currentSemester||"1").join(", ");

  const dirGuide={
    method:`탐구방법만 바꾸기: 원본의 주제·소재는 유지하되 탐구방법을 완전히 다른 방식으로 바꿔라. 원본이 데이터 분석형이면 실험형·제작형·설문형 등으로 전환하고, 그에 맞는 절차·도구·산출물을 새로 설계하라.`,
    context:`맥락·대상 바꾸기: 원본의 탐구방법과 구조는 유지하되 적용 맥락(지역·시대·집단·국가·산업)을 바꿔라. 예: 서울 → 지방, 청소년 → 노인, 한국 → OECD 비교 등으로 전환하라.`,
    depth:`심화·확장하기: 원본 주제를 더 깊이 파고들거나 범위를 확장하라. 원본이 1단계 탐구라면 그 결과를 바탕으로 한 2단계 심화탐구로 발전시켜라.`,
    fusion:`융합형으로 변형: 원본 주제를 다른 교과·분야와 결합해 융합탐구로 재설계하라. 예: 과학+사회, 수학+예술, 경제+윤리 등의 융합 구조로 만들어라.`,
    full:`완전 재설계: 원본 사례의 핵심 구조(탐구방법 선택 방식, 질문 접근법, 산출물 설계)만 참고하고, 주제·내용·방법·질문을 완전히 새롭게 만들어라.`,
  };

  return `${SYSTEM}

[학생 정보]
${p}
설계 기간: ${sems}

[내부 DB 참고자료]
${dbCtx}

[변형 대상 합격사례]
대학·학과: ${base.u||""} / ${base.m||""}
원본 주제구조: ${base.t||""}
탐구방법: ${base.method||""}
교과: ${base.subject||""}
핵심 키워드: ${base.k||""}
핵심역량: ${(base.focus||[]).join(", ")}
교과 개념: ${(base.concepts||[]).join(", ")}
산출물 구조: ${(base.outputs||[]).join(", ")}
사례 구조유형: ${base.sourceStructure||""}
계열: ${base.track||""}

[변형 방향]
${dirGuide[dir]||dirGuide.full}

[추가 지시사항]
${hint||"없음"}

[변형 설계 원칙]
1. 원본 사례를 직접 복제하지 않는다. 구조·방법론·접근법만 참고한다.
2. 학생의 대학급(${p.split('\n')[0].replace('대학급: ','')})과 세부학과(${p.split('\n')[2].replace('세부학과: ','')})에 맞게 최적화한다.
3. 2022 개정 교육과정 과목(${p.split('\n')[4].replace('2022 개정 과목: ','')})과 직접 연결한다.
4. 변형 방향(${dir})에 충실하되, 고등학생이 실제 수행 가능한 수준으로 설계한다.
5. 5개 주제는 서로 다른 탐구방법·질문 방향·산출물을 가져야 한다.

변형된 탐구 주제 5개를 생성하라.
반드시 순수 JSON만 출력한다. 마크다운·코드블록·설명문 절대 금지.

{
 "topics":[
  {
   "type":"탐구유형",
   "title":"구체적 제목(원본과 다른 새로운 주제)",
   "question":"핵심 탐구 질문(의문문)",
   "summary":"3~4문장 탐구 개요",
   "majorFit":"세부학과 적합성 이유",
   "curriculumFit":"2022 개정 과목 연결 개념",
   "sourceCase":"원본 사례 어느 부분을 어떻게 변형했는지 설명",
   "duplicateCheck":"원본 및 다른 주제들과 겹치지 않는 차별 지점",
   "differentiator":"이 변형 주제만의 독창성",
   "tags":["키워드1","키워드2","키워드3"],
   "evidence":{
    "subject":"교과 근거",
    "book":"자료·도서 근거",
    "admission":"대학급 평가 관점"
   },
   "methodDetail":{
    "name":"탐구방법명",
    "steps":["1단계","2단계","3단계","4단계","5단계"],
    "tools":["도구1","도구2","도구3"],
    "outputs":["산출물1","산출물2","산출물3"],
    "cautions":["주의사항1","주의사항2"]
   },
   "roadmap":[
    {
     "title":"단계명",
     "semester":"고1-1 등",
     "detail":"구체적 수행 내용(3~4문장)",
     "activities":["교과 세특 연결","창체/진로 활동","탐구 수행"],
     "tools":["도구","방법","자료"]
    }
   ]
  }
 ]
}`;
}
