/**
 * One answer from several models. Each answers on its own, one after another because a small GPU holds one model at a
 * time, then the best one reads the answers without knowing whose they are and writes the final answer. Disagreement is
 * kept and reported: one confident paragraph must not hide that the models did not agree.
 */
export type MergeAsk=(input:string,model:string,maxOutputTokens:number)=>Promise<{output:string}>;
export interface MergeSource{model:string;ok:boolean;ms:number;answer?:string;error?:string}
export interface MergeResult{answer:string;agreement:"full"|"partial"|"none"|"single";disagreements:string[];merged:boolean;mergedBy?:string;sources:MergeSource[]}
const ANSWER_TOKENS=900,MERGE_TOKENS=1100,ANSWER_LIMIT=2400;

const extract=(text:string)=>{
  const start=text.indexOf("{"),end=text.lastIndexOf("}");
  if(start<0||end<=start)return undefined;
  try{return JSON.parse(text.slice(start,end+1)) as {answer?:unknown;agreement?:unknown;disagreements?:unknown};}catch{return undefined;}
};
export function buildMergePrompt(question:string,answers:string[]):string{
  return[
    "Several independent assistants answered the same question. Write the single best final answer. Return ONLY JSON:",
    '{"answer":"the final answer, in the language of the question","agreement":"full|partial|none","disagreements":["what they disagreed on, in one short line each"]}',
    "Rules: work the question out yourself before choosing. The majority can be wrong: a well-reasoned minority answer wins over a confident majority. Use only facts that an answer gave or that you can verify by reasoning. Do not mention the assistants in the answer.",
    "Question:\n"+question,
    ...answers.map((answer,i)=>`Answer ${i+1}:\n${answer.slice(0,ANSWER_LIMIT)}`)
  ].join("\n\n");
}
export async function mergeModels(input:{question:string;models:string[];merger?:string;ask:MergeAsk}):Promise<MergeResult>{
  const models=[...new Set(input.models)];
  if(!models.length)throw new Error("No model is available to answer.");
  const sources:MergeSource[]=[];
  for(const model of models){
    const started=Date.now();
    try{
      const {output}=await input.ask(input.question,model,ANSWER_TOKENS);
      if(!output.trim())throw new Error("empty answer");
      sources.push({model,ok:true,ms:Date.now()-started,answer:output.trim()});
    }catch(error){sources.push({model,ok:false,ms:Date.now()-started,error:(error as Error).message.slice(0,300)});}
  }
  const answered=sources.filter(source=>source.ok);
  if(!answered.length)throw new Error("No model answered: "+sources.map(source=>`${source.model}: ${source.error}`).join("; "));
  if(answered.length===1)return{answer:answered[0]!.answer!,agreement:"single",disagreements:[],merged:false,sources};
  const merger=[input.merger,...answered.map(source=>source.model)].filter((model):model is string=>Boolean(model)&&answered.some(source=>source.model===model))[0]!;
  try{
    const {output}=await input.ask(buildMergePrompt(input.question,answered.map(source=>source.answer!)),merger,MERGE_TOKENS);
    const parsed=extract(output);
    if(typeof parsed?.answer==="string"&&parsed.answer.trim()){
      const agreement=parsed.agreement==="full"||parsed.agreement==="none"?parsed.agreement:"partial";
      return{answer:parsed.answer.trim(),agreement,disagreements:Array.isArray(parsed.disagreements)?parsed.disagreements.filter((d):d is string=>typeof d==="string").slice(0,6):[],merged:true,mergedBy:merger,sources};
    }
  }catch{}
  // The merge step failed: the first answer is still an answer, and it must not be described as merged.
  return{answer:answered[0]!.answer!,agreement:"none",disagreements:["The answers could not be merged, so this is the first model's answer."],merged:false,sources};
}
