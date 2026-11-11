/**
 * Small local models (3B-8B) plan badly when the prompt lists every tool the
 * runtime has. Send only the tools that match the goal, sized to the model.
 * Matching is done on whole words (Arabic and English), never substrings:
 * "latest" must not match "test", "prefix" must not match "fix".
 */
export interface CatalogTool{name:string;description?:string;actions?:string[];tags?:string[];permission?:string;dangerous?:boolean}

export function normalizeArabic(text:string):string{
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g,"")
    .replace(/[أإآٱ]/g,"ا")
    .replace(/ى/g,"ي")
    .replace(/ة/g,"ه")
    .replace(/ؤ/g,"و")
    .replace(/ئ/g,"ي");
}

const AR_PREFIXES=["وال","بال","فال","كال","لل","ال"];

export function tokenize(text:string):string[]{
  const out=new Set<string>();
  for(const raw of normalizeArabic(text).split(/[^\p{L}\p{N}]+/u)){
    if(!raw)continue;
    out.add(raw);
    for(const prefix of AR_PREFIXES){
      if(raw.startsWith(prefix)&&raw.length-prefix.length>=3){out.add(raw.slice(prefix.length));break;}
    }
    if(/^[a-z]+s$/.test(raw)&&raw.length>3)out.add(raw.slice(0,-1));
  }
  return [...out];
}

// Strong terms are unambiguous on their own; weak terms ("fix", "build") also
// appear in marketing goals ("fix the ad copy"), so they need a second signal.
const STRONG_DEV=new Set([
  "test","testing","typecheck","tsc","lint","eslint","debug","bug","refactor","code","repo","repository","npm","git",
  "typescript","javascript","python","stacktrace",
  "اختبار","اختبارات","كود","برمجه","برمجي","مستودع","تنقيح"
].map(normalizeArabic));
const WEAK_DEV=new Set(["fix","build","compile","commit","branch","merge","function","exception","error","اصلاح","خطا","بناء"].map(normalizeArabic));

/** Drop-in replacement for the substring-based isDevelopmentGoal in src/core/ai-planner.ts. */
export function isDevelopmentGoal(goal:string):boolean{
  const tokens=tokenize(goal);
  if(tokens.some(token=>STRONG_DEV.has(token)))return true;
  return tokens.filter(token=>WEAK_DEV.has(token)).length>=2;
}

export function toolBudgetFor(model?:{paramsB:number;contextLength:number}|null):number{
  let budget=12;
  if(model&&model.paramsB>0)budget=model.paramsB<=4?6:model.paramsB<=9?10:model.paramsB<=20?16:24;
  if(model&&model.contextLength>0&&model.contextLength<=4096)budget=Math.min(budget,8);
  return budget;
}

const PERMISSION_ORDER:Record<string,number>={L1_READ:0,L2_ANALYZE:1,L3_MODIFY:2,L4_EXECUTE:3};

/** Words that carry no meaning for choosing a tool ("عن" matched "البحث عن أداة MCP" for a goal about customers). */
const STOP_WORDS=new Set(["عن","لي","في","من","على","الى","الي","ما","ماذا","هل","او","ثم","و","مع","هذا","هذه","ذلك","التي","الذي","كل","بعد","قبل","اريد","اريدك","منك","لك","لنا","انا","انت","يا",
  "the","a","an","to","of","for","in","on","at","and","or","me","my","please","with","from","by","is","it","this","that"].map(normalizeArabic));
/**
 * Arabic and English words for the same need, mapped to one concept, so an Arabic goal can reach a tool described in
 * English: "التقط صورة للشاشة" -> screenshot + screen -> desktop.screenshot. Applied to the goal and to each tool's text.
 */
const CONCEPTS:Array<[string,string[]]>=([
  ["search",["ابحث","بحث","فتش","دور","search","find","lookup","look up"]],
  ["research",["ابحث","بحث","ابحاث","research","investigate"]],
  ["internet",["انترنت","ويب","جوجل","google","web","online","internet"]],
  ["leads",["عملاء","عميل","زبائن","زبون","محتملين","محتمل","leads","lead","prospects","prospect","customers","clients"]],
  ["screenshot",["التقط","لقطه","صوره","screenshot","capture"]],
  ["screen",["شاشه","screen","display","desktop"]],
  ["describe",["صف","وصف","اوصف","ترى","تراه","تشاهد","describe","see","look","vision"]],
  ["read",["اقرا","قراءه","اعرض","read","show","list"]],
  ["email",["بريد","ايميل","رساله","رسائل","email","mail","gmail","inbox"]],
  ["file",["ملف","ملفات","مجلد","file","files","folder"]],
  ["browser",["متصفح","كروم","موقع","صفحه","browser","chrome","website","site","page"]],
  ["window",["نافذه","نوافذ","window","windows"]],
  ["click",["اضغط","انقر","click","press"]],
  ["trade",["تداول","صفقه","صفقات","trade","trading"]],
  ["post",["انشر","منشور","منشورات","post","publish"]],
  ["store",["متجر","منتج","منتجات","طلبات","store","shop","product","products","woocommerce"]],
  ["schedule",["جدول","موعد","ذكرني","schedule","remind","reminder","calendar"]],
  ["ship",["شحن","شحنه","شحنات","ship","shipping","shipment"]]
] as Array<[string,string[]]>).map(([concept,words])=>[concept,words.map(normalizeArabic)] as [string,string[]]);
const CONCEPT_OF=new Map<string,string[]>();
for(const [concept,words] of CONCEPTS)for(const w of words){const list=CONCEPT_OF.get(w)??[];if(!list.includes(concept))list.push(concept);CONCEPT_OF.set(w,list);}
function withConcepts(tokens:string[]):string[]{
  const out=new Set<string>();
  for(const t of tokens){
    if(STOP_WORDS.has(t))continue;
    out.add(t);
    // Possessive endings: "بريدي" (my mail) and "ملفاتنا" (our files) mean what "بريد" and "ملفات" mean.
    const stem=/^[؀-ۿ]{4,}$/.test(t)?t.replace(/(?:هم|كم|نا|ها|ي|ك|ه)$/u,""):t;
    if(stem!==t&&stem.length>=3)out.add(stem);
    for(const w of new Set([t,stem]))for(const c of CONCEPT_OF.get(w)??[])out.add("~"+c);
  }
  return [...out];
}
/** Tokens of a goal or a tool text, without stop words and with the concepts they name. */
export function meaningTokens(text:string):string[]{return withConcepts(tokenize(text));}

export function selectToolsForGoal<T extends CatalogTool>(goal:string,tools:T[],budget:number):T[]{
  if(tools.length<=budget)return tools;
  const goalTokens=new Set(meaningTokens(goal));
  const normalizedGoal=normalizeArabic(goal);
  const scored=tools.map((tool,index)=>{
    let score=0;
    if(normalizedGoal.includes(tool.name.toLowerCase()))score+=20;
    // Each word or concept counts once per field, so a tool is not rewarded for repeating itself.
    const hits=(text:string)=>new Set(meaningTokens(text).filter(t=>goalTokens.has(t))).size;
    score+=5*hits(tool.name.replace(/[._-]/g," "));
    score+=3*hits((tool.tags??[]).join(" "));
    for(const action of tool.actions??[]){
      const actionTokens=meaningTokens(action).filter(t=>!t.startsWith("~"));
      const n=hits(action);
      if(n)score+=2*n+(actionTokens.length>0&&actionTokens.every(t=>goalTokens.has(t))?4:0);
    }
    score+=hits(tool.description??"");
    return{tool,index,score};
  });
  return scored
    .sort((a,b)=>b.score-a.score
      ||(PERMISSION_ORDER[a.tool.permission??""]??9)-(PERMISSION_ORDER[b.tool.permission??""]??9)
      ||a.index-b.index)
    .slice(0,budget)
    .map(x=>x.tool);
}
