import type {ModelCapability,ModelDefinition} from "../models/registry.js";
import type {ModelRequest} from "../models/inference.js";
import {ModelRegistry} from "../models/registry.js";
import {UnifiedModelCouncil,type CouncilPlan} from "./unified-model-council.js";

export type WorkClass="conversation"|"research"|"coding"|"project"|"verification";
export interface ModelManagementPolicy{
  mode:"single"|"adaptive"|"council";
  maxSpecialists:number;
  allowCloud:boolean;
  preferLocalForSimple:boolean;
  synthesizerProvider?:string;
}
export const DEFAULT_MODEL_POLICY:ModelManagementPolicy={
  mode:"adaptive",maxSpecialists:3,allowCloud:true,preferLocalForSimple:true
};
const COMPLEX=/(?:build|implement|refactor|debug|review|audit|project|application|architecture|اختبر|برمج|ابن|صمم تطبيق|مشروع|راجع الكود|اصلح|أصلح)/iu;
const RESEARCH=/(?:research|investigate|compare|analy[sz]e|ابحث|قارن|حلل|دراسة)/iu;
const VERIFY=/(?:verify|test|validate|audit|تحقق|اختبر|افحص|راجع النتائج)/iu;
export function classifyWork(goal:string):WorkClass{
  if(VERIFY.test(goal))return"verification";
  if(/(?:project|application|مشروع|تطبيق كامل)/iu.test(goal))return"project";
  if(/(?:code|implement|refactor|debug|برمج|الكود|اصلح|أصلح)/iu.test(goal))return"coding";
  if(RESEARCH.test(goal))return"research";
  return"conversation";
}
export function shouldUseCouncil(goal:string,policy:ModelManagementPolicy=DEFAULT_MODEL_POLICY){
  return policy.mode==="council"||(policy.mode==="adaptive"&&COMPLEX.test(goal));
}
const preferred:Record<Exclude<WorkClass,"conversation">,string[]>={
  coding:["anthropic","openai","gemini","kimi"],
  project:["anthropic","openai","gemini","kimi"],
  research:["gemini","kimi","openai","anthropic"],
  verification:["openai","anthropic","gemini","kimi"]
};
function supports(model:ModelDefinition,capability:ModelCapability){
  return model.enabled&&model.capabilities.includes(capability);
}
/** Select distinct providers only; do not assume any model is available until registered. */
export function buildCouncilPlan(goal:string,models:ModelRegistry,policy:ModelManagementPolicy=DEFAULT_MODEL_POLICY):CouncilPlan|undefined{
  if(!shouldUseCouncil(goal,policy))return undefined;
  const work=classifyWork(goal);
  const capability:ModelCapability=work==="coding"||work==="project"?"coding":"reasoning";
  const candidates=models.list().filter(m=>supports(m,capability)&&(policy.allowCloud||m.local));
  const ordered=work==="conversation"?["ollama","openai","anthropic","gemini","kimi"]:preferred[work];
  candidates.sort((a,b)=>{
    const ai=ordered.indexOf(a.provider),bi=ordered.indexOf(b.provider);
    return(ai<0?99:ai)-(bi<0?99:bi)||a.priority-b.priority;
  });
  const unique:ModelDefinition[]=[];
  for(const model of candidates)if(!unique.some(x=>x.provider===model.provider))unique.push(model);
  if(unique.length<2)return undefined;
  const max=Math.max(1,Math.min(3,policy.maxSpecialists));
  const specialists=unique.slice(0,max).map((m,i)=>({provider:m.provider,modelId:m.id,role:i===0?"primary":i===1?"independent reviewer":"alternative analysis"}));
  const synth=unique.find(m=>m.provider===policy.synthesizerProvider&&supports(m,"reasoning"))
    ??unique.find(m=>supports(m,"reasoning")&&!specialists.some(s=>s.modelId===m.id))
    ??unique.find(m=>supports(m,"reasoning"));
  if(!synth)return undefined;
  return{specialists,synthesizer:{provider:synth.provider,modelId:synth.id},maxSpecialists:max};
}
export async function runManagedCouncil(goal:string,request:ModelRequest,models:ModelRegistry,council:UnifiedModelCouncil,policy:ModelManagementPolicy=DEFAULT_MODEL_POLICY){
  const plan=buildCouncilPlan(goal,models,policy);
  if(!plan)return undefined;
  return council.execute(request,plan);
}
