import {existsSync,readFileSync} from "node:fs";
import {ModelRegistry,type ModelCapability,type ModelDefinition} from "../models/registry.js";
import {ModelProviderRegistry} from "../core/model-execution.js";
import {createOpenAIProvider} from "../providers/openai-provider.js";
import {createOllamaProvider} from "../providers/ollama-provider.js";
import {createAnthropicProvider} from "../providers/anthropic-provider.js";
import {createGeminiProvider} from "../providers/gemini-provider.js";
import {FreeCapacityProvider,freeProviderRuntimeName,type FreeCapacitySpec} from "../providers/free-capacity.js";
import {FREE_LLM_DIRECTORY} from "../providers/free-llm-directory.js";
import {localSecret} from "../security/local-secret-vault.js";
export type ProviderMode="local"|"cloud"|"hybrid";
export interface ProviderRuntimeConfig{
 mode:ProviderMode;
 ollama:{enabled:boolean;baseUrl:string;model:string;visionModel:string};
 openai:{enabled:boolean;apiKey?:string;baseUrl:string;healthUrl:string;model:string};
 anthropic:{enabled:boolean;apiKey?:string;baseUrl:string;healthUrl:string;model:string};
 gemini:{enabled:boolean;apiKey?:string;baseUrl:string;healthUrl:string;model:string};
 freePool:{enabled:boolean;configPath:string;providers:FreeCapacitySpec[]};
}
function loadFreePool(env:NodeJS.ProcessEnv){
 const enabled=env.LAYANX_FREE_POOL_ENABLED==="true";
 const configPath=env.LAYANX_FREE_POOL_CONFIG??".layanx/free-providers.json";
 if(!enabled)return{enabled,configPath,providers:[] as FreeCapacitySpec[]};
 if(!existsSync(configPath)){
  const providers=FREE_LLM_DIRECTORY.map(entry=>({...entry,apiKey:localSecret(entry.keyEnv)??env[entry.keyEnv]})).filter(entry=>Boolean(entry.apiKey)).map(entry=>({name:entry.name,baseUrl:entry.baseUrl,apiKey:entry.apiKey,apiKeyEnv:entry.keyEnv,models:entry.models,capabilities:entry.capabilities,priority:entry.priority,tags:entry.tags}));
  return{enabled,configPath,providers};
 }
 try{
  const parsed=JSON.parse(readFileSync(configPath,"utf8")) as {providers?:FreeCapacitySpec[]};
  if(!Array.isArray(parsed.providers))throw new Error("free provider config must contain a providers array");
  const providers=parsed.providers.map((item,index)=>{
   if(!item.name||!item.baseUrl||!Array.isArray(item.models)||!item.models.length)throw new Error("Invalid free provider entry at index "+index);
   return{...item,apiKey:item.apiKey??(item.apiKeyEnv?localSecret(item.apiKeyEnv)??env[item.apiKeyEnv]:undefined)};
  });
  return{enabled,configPath,providers};
 }catch(error){throw new Error("Invalid LAYANX_FREE_POOL_CONFIG: "+(error instanceof Error?error.message:"unable to read config"));}
}
export function loadProviderConfig(env:NodeJS.ProcessEnv=process.env):ProviderRuntimeConfig{
 const mode=(env.LAYANX_AI_MODE??"local") as ProviderMode;if(!["local","cloud","hybrid"].includes(mode))throw new Error("Invalid LAYANX_AI_MODE.");
 return{mode,
  ollama:{enabled:env.OLLAMA_ENABLED!=="false",baseUrl:(env.OLLAMA_BASE_URL??"http://127.0.0.1:11434").replace(/\/$/,""),model:env.OLLAMA_MODEL?.trim()||"llama3.2:3b",visionModel:env.OLLAMA_VISION_MODEL??"moondream:1.8b" /* "" = no vision model */},
  openai:{enabled:env.OPENAI_ENABLED==="true",apiKey:env.OPENAI_API_KEY,baseUrl:env.OPENAI_BASE_URL??"https://api.openai.com/v1/responses",healthUrl:env.OPENAI_HEALTH_URL??"https://api.openai.com/v1/models",model:env.OPENAI_MODEL?.trim()||"gpt-5.6-terra"},
  anthropic:{enabled:env.ANTHROPIC_ENABLED==="true",apiKey:env.ANTHROPIC_API_KEY,baseUrl:env.ANTHROPIC_BASE_URL??"https://api.anthropic.com/v1/messages",healthUrl:env.ANTHROPIC_HEALTH_URL??"https://api.anthropic.com/v1/models",model:env.ANTHROPIC_MODEL?.trim()||"claude-sonnet-5-5"},
  gemini:{enabled:env.GEMINI_ENABLED==="true",apiKey:env.GEMINI_API_KEY,baseUrl:env.GEMINI_BASE_URL??"https://generativelanguage.googleapis.com/v1beta",healthUrl:env.GEMINI_HEALTH_URL??"https://generativelanguage.googleapis.com/v1beta/models",model:env.GEMINI_MODEL?.trim()||"gemini-3.6-flash"},
  freePool:loadFreePool(env)
 };
}

type TaskPlan=Partial<Record<"general"|"planning"|"coding"|"vision"|"embedding"|"fast",string|null>>;
/**
 * Per-task local models picked by the local host from what is installed
 * (LAYANX_OLLAMA_MODEL_PLAN). The main model (OLLAMA_MODEL) stays the fallback
 * for every text task; a specialised model wins only its own job:
 *  - general -> "chat" (priority 0)      - coding -> "coding" (priority 0)
 *  - fast    -> latency-sensitive chat/reasoning (latencyClass fast; voice replies)
 *  - embedding -> "embedding"
 * LAYANX_OLLAMA_ROUTING=single keeps one model for everything (fewer model swaps on small GPUs).
 */
export function ollamaTaskModels(raw:string|undefined,main:string,vision:string):ModelDefinition[]{
 let plan:TaskPlan={};
 try{plan=raw?JSON.parse(raw) as TaskPlan:{};}catch{return[];}
 const entries=new Map<string,{caps:Set<ModelCapability>;priority:number;latency?:"fast";tags:Set<string>}>();
 const add=(id:string|null|undefined,cap:ModelCapability,priority:number,tag:string,latency?:"fast")=>{
  if(!id||id===main||id===vision)return;
  const e=entries.get(id)??{caps:new Set<ModelCapability>(),priority,tags:new Set<string>()};
  e.caps.add(cap);e.priority=Math.min(e.priority,priority);e.tags.add(tag);if(latency)e.latency=latency;
  entries.set(id,e);
 };
 add(plan.general,"chat",0,"general");
 add(plan.coding,"coding",0,"coding");
 add(plan.fast,"chat",3,"fast","fast");
 add(plan.embedding,"embedding",1,"embedding");
 const fast=plan.fast?entries.get(plan.fast):undefined;
 if(fast&&fast.priority===3)fast.caps.add("reasoning"); // only a dedicated small model may answer latency-sensitive planning
 return[...entries].map(([id,e])=>({id,provider:"ollama",capabilities:[...e.caps],local:true,enabled:true,priority:e.priority,tags:[...e.tags,"auto-routed"],...(e.latency?{latencyClass:e.latency}:{})}));
}
export function configureProviders(config=loadProviderConfig(),models=new ModelRegistry(),providers=new ModelProviderRegistry()){
 const allowLocal=config.mode==="local"||config.mode==="hybrid";const allowCloud=config.mode==="cloud"||config.mode==="hybrid";
 if(config.ollama.enabled&&allowLocal){providers.register(createOllamaProvider({baseUrl:config.ollama.baseUrl}));
   const mainSeesImages=config.ollama.visionModel===config.ollama.model;
   models.register({id:config.ollama.model,provider:"ollama",capabilities:["chat","reasoning","coding",...(mainSeesImages?["vision" as const]:[])],local:true,enabled:true,priority:1,...(mainSeesImages?{tags:["computer-use","vision"]}:{})});
   if(config.ollama.visionModel&&!mainSeesImages)models.register({id:config.ollama.visionModel,provider:"ollama",capabilities:["vision"],local:true,enabled:true,priority:2,tags:["computer-use","vision"]});
   if(process.env.LAYANX_OLLAMA_ROUTING!=="single")for(const extra of ollamaTaskModels(process.env.LAYANX_OLLAMA_MODEL_PLAN,config.ollama.model,config.ollama.visionModel))models.register(extra);}
 // Cloud models for work the local models cannot do well. Order = LAYANX_CLOUD_ORDER (default openai,anthropic,gemini).
 // Tags let a goal ask for one provider by name ("use Claude"), see cloudRoutingForGoal().
 let priority=10;
 const cloudTimeout=Number(process.env.LAYANX_CLOUD_TIMEOUT_MS)||120000;
 const cloud={
  openai:()=>{if(!(config.openai.enabled&&config.openai.apiKey))return;providers.register(createOpenAIProvider({apiKey:config.openai.apiKey,baseUrl:config.openai.baseUrl,healthUrl:config.openai.healthUrl,timeoutMs:cloudTimeout}));models.register({id:config.openai.model,provider:"openai",capabilities:["chat","reasoning","coding","vision"],local:false,enabled:true,priority:priority++,tags:["openai","gpt","cloud"]});},
  anthropic:()=>{if(!(config.anthropic.enabled&&config.anthropic.apiKey))return;providers.register(createAnthropicProvider({apiKey:config.anthropic.apiKey,baseUrl:config.anthropic.baseUrl,healthUrl:config.anthropic.healthUrl,timeoutMs:cloudTimeout}));models.register({id:config.anthropic.model,provider:"anthropic",capabilities:["chat","reasoning","coding","vision"],local:false,enabled:true,priority:priority++,tags:["anthropic","claude","cloud"]});},
  gemini:()=>{if(!(config.gemini.enabled&&config.gemini.apiKey))return;providers.register(createGeminiProvider({apiKey:config.gemini.apiKey,baseUrl:config.gemini.baseUrl,healthUrl:config.gemini.healthUrl,timeoutMs:cloudTimeout}));models.register({id:config.gemini.model,provider:"gemini",capabilities:["chat","reasoning","coding","vision","audio"],local:false,enabled:true,priority:priority++,tags:["gemini","google","cloud"]});}
 } as const;
 if(allowCloud){
  const order=(process.env.LAYANX_CLOUD_ORDER??"openai,anthropic,gemini").split(",").map(v=>v.trim()).filter((v):v is keyof typeof cloud=>v in cloud);
  for(const name of [...new Set([...order,"openai","anthropic","gemini"] as Array<keyof typeof cloud>)])cloud[name]();
 }
 if(config.freePool.enabled&&allowCloud){
  for(const spec of config.freePool.providers){
   const runtimeName=freeProviderRuntimeName(spec.name);const provider=new FreeCapacityProvider({...spec,name:runtimeName});providers.register(provider);
   const capabilities=spec.capabilities??["chat","reasoning","coding"];const providerPriority=spec.priority??priority++;
   for(const providerModelId of spec.models){
    const id=runtimeName+":"+providerModelId;
    models.register({id,provider:runtimeName,providerModelId,capabilities,local:false,enabled:true,priority:providerPriority,costPer1kInputUsd:0,costPer1kOutputUsd:0,tags:[...(spec.tags??[]),"free"]});
   }
  }
 }
 return{models,providers};
}
export function providerSummary(config=loadProviderConfig()){
 return{mode:config.mode,
  ollama:{enabled:config.ollama.enabled,baseUrl:config.ollama.baseUrl,model:config.ollama.model,visionModel:config.ollama.visionModel,routing:process.env.LAYANX_OLLAMA_ROUTING==="single"?"single":"per-task",taskModels:ollamaTaskModels(process.env.LAYANX_OLLAMA_MODEL_PLAN,config.ollama.model,config.ollama.visionModel).map(m=>({model:m.id,capabilities:m.capabilities}))},
  openai:{enabled:config.openai.enabled,configured:Boolean(config.openai.apiKey),baseUrl:config.openai.baseUrl,healthUrl:config.openai.healthUrl,model:config.openai.model},
  anthropic:{enabled:config.anthropic.enabled,configured:Boolean(config.anthropic.apiKey),baseUrl:config.anthropic.baseUrl,healthUrl:config.anthropic.healthUrl,model:config.anthropic.model},
  gemini:{enabled:config.gemini.enabled,configured:Boolean(config.gemini.apiKey),baseUrl:config.gemini.baseUrl,healthUrl:config.gemini.healthUrl,model:config.gemini.model},
  freePool:{enabled:config.freePool.enabled,configPath:config.freePool.configPath,providers:config.freePool.providers.map(provider=>({name:provider.name,baseUrl:provider.baseUrl,models:provider.models,capabilities:provider.capabilities??["chat","reasoning","coding"],priority:provider.priority??null,dailyTokenLimit:provider.dailyTokenLimit??null,monthlyTokenLimit:provider.monthlyTokenLimit??null,tags:provider.tags??[]}))}};
}

/**
 * Cloud escalation (LAYANX_CLOUD_POLICY):
 *  - off      : local models only
 *  - fallback : local first; a cloud model takes over only when the local one fails (default when a key is set)
 *  - complex  : like fallback, and complex goals are planned by the cloud model from the start
 * Naming a provider in the goal ("use Claude", "استخدم جيميني") always routes that mission to it.
 */
export type CloudPolicy="off"|"fallback"|"complex";
export function cloudPolicy(env:NodeJS.ProcessEnv=process.env):CloudPolicy{
 const v=(env.LAYANX_CLOUD_POLICY??"").trim();
 return v==="off"||v==="complex"?v:"fallback";
}
const PROVIDER_HINTS:Array<[RegExp,string]>=[
 [/\b(claude|anthropic)\b|كلود|انثروبيك/i,"anthropic"],
 [/\b(gpt|openai|chatgpt)\b|اوبن ?اي|أوبن ?إي|شات ?جي ?بي ?تي|جي ?بي ?تي/i,"openai"],
 [/\bgemini\b|جيميني|جيمناي|جمناي/i,"gemini"]
];
const COMPLEX=/\b(architecture|refactor|redesign|strategy|in depth|step by step plan|complex|full (project|plan|app))\b|معماري|إعادة هيكلة|اعادة هيكلة|استراتيجية|خطة كاملة|بشكل معمق|بعمق|معقد|مشروع كامل|تطبيق كامل/i;
export function isComplexGoal(goal:string):boolean{
 if(goal.length>320)return true;
 if(COMPLEX.test(goal))return true;
 const steps=goal.split(/\bthen\b|ثم|،\s*و|\n/i).filter(s=>s.trim().length>8).length;
 return steps>=4;
}
export function cloudRoutingForGoal(goal:string,models:{list():ModelDefinition[]},env:NodeJS.ProcessEnv=process.env):ModelRoutingHint|undefined{
 const cloud=models.list().filter(m=>!m.local&&m.enabled);
 if(!cloud.length)return undefined;
 for(const [rx,provider] of PROVIDER_HINTS)if(rx.test(goal)&&cloud.some(m=>m.provider===provider))return{preferLocal:false,tags:[provider],reason:"named"};
 if(cloudPolicy(env)==="complex"&&isComplexGoal(goal))return{preferLocal:false,reason:"complex"};
 return undefined;
}
export interface ModelRoutingHint{preferLocal:boolean;tags?:string[];reason:"named"|"complex"|"fallback"|"learned"}
