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

export function selectToolsForGoal<T extends CatalogTool>(goal:string,tools:T[],budget:number):T[]{
  if(tools.length<=budget)return tools;
  const goalTokens=new Set(tokenize(goal));
  const normalizedGoal=normalizeArabic(goal);
  const scored=tools.map((tool,index)=>{
    let score=0;
    if(normalizedGoal.includes(tool.name.toLowerCase()))score+=20;
    for(const t of tokenize(tool.name.replace(/[._-]/g," ")))if(goalTokens.has(t))score+=5;
    for(const tag of tool.tags??[])for(const t of tokenize(tag))if(goalTokens.has(t))score+=3;
    for(const action of tool.actions??[]){
      const actionTokens=tokenize(action);
      const hits=actionTokens.filter(t=>goalTokens.has(t)).length;
      if(hits)score+=2*hits+(hits===actionTokens.length?4:0);
    }
    for(const t of tokenize(tool.description??""))if(goalTokens.has(t))score+=1;
    return{tool,index,score};
  });
  return scored
    .sort((a,b)=>b.score-a.score
      ||(PERMISSION_ORDER[a.tool.permission??""]??9)-(PERMISSION_ORDER[b.tool.permission??""]??9)
      ||a.index-b.index)
    .slice(0,budget)
    .map(x=>x.tool);
}
