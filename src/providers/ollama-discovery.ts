import {execFileSync} from "node:child_process";
import os from "node:os";
import {safeChildEnv} from "../platform/safe-env.js";

/**
 * Works with whatever the user already installed in Ollama. Nothing is
 * hard-coded: models come from /api/tags, real capabilities (tools, vision,
 * thinking, embedding) and context length come from /api/show, and each task
 * gets the best fit for THIS machine's memory. Name heuristics are used only
 * when an older Ollama does not report capabilities.
 */
export type ModelTask="general"|"planning"|"coding"|"vision"|"embedding"|"fast";
export const MODEL_TASKS:readonly ModelTask[]=["general","planning","coding","vision","embedding","fast"];

export interface OllamaModelProfile{
  name:string;
  sizeBytes:number;
  family:string;
  parameterSize:string;
  paramsB:number;
  quantization:string;
  capabilities:string[];
  capabilitySource:"ollama"|"heuristic";
  contextLength:number;
}

export interface OllamaDiscovery{
  baseUrl:string;
  reachable:boolean;
  version?:string;
  models:OllamaModelProfile[];
  loaded:string[];
  discoveredAt:string;
  error?:string;
}

export interface MachineProfile{totalMemBytes:number;freeMemBytes:number;/** dedicated GPU memory, 0 when unknown or no NVIDIA GPU */gpuVramBytes?:number}

let cachedVram:number|undefined;
/**
 * NVIDIA VRAM via nvidia-smi (ships with the driver on Windows and Linux).
 * LAYANX_GPU_VRAM_MB overrides it (AMD/Intel GPUs, or to leave room for other apps).
 */
export function detectGpuVramBytes(env:NodeJS.ProcessEnv=process.env):number{
  const override=Number(env.LAYANX_GPU_VRAM_MB);
  if(env.LAYANX_GPU_VRAM_MB?.trim()&&Number.isFinite(override)&&override>=0)return override*2**20;
  if(cachedVram!==undefined)return cachedVram;
  try{
    const out=execFileSync("nvidia-smi",["--query-gpu=memory.total","--format=csv,noheader,nounits"],{timeout:2500,windowsHide:true,encoding:"utf8",env:safeChildEnv(),stdio:["ignore","pipe","ignore"]});
    const mb=Math.max(0,...out.split(/\r?\n/).map(l=>Number(l.trim())).filter(n=>Number.isFinite(n)));
    cachedVram=mb*2**20;
  }catch{cachedVram=0;}
  return cachedVram;
}
export const currentMachine=():MachineProfile=>({totalMemBytes:os.totalmem(),freeMemBytes:os.freemem(),gpuVramBytes:detectGpuVramBytes()});

export type FetchLike=(input:string,init?:{method?:string;headers?:Record<string,string>;body?:string;signal?:AbortSignal})=>Promise<{ok:boolean;status:number;text():Promise<string>}>;

export class OllamaHttpError extends Error{
  readonly status:number;
  constructor(status:number,message:string){super(message);this.name="OllamaHttpError";this.status=status;}
}

const RX={
  embedding:/embed|(^|[-/:])bge[-:]|minilm|mxbai|arctic-embed|(^|[-/:])e5[-:]|granite-embedding/i,
  vision:/llava|vision|moondream|minicpm-v|qwen2\.5-?vl|qwen-?vl|qwen2-vl|gemma3(?!n|:1b|:270m)|llama4|mistral-small3\.[12]/i,
  tools:/llama3\.[1-3]|llama4|qwen2\.5|qwen3|qwq|mistral|mixtral|command-r|hermes|firefunction|granite3|gpt-oss|smollm2|phi4-mini|devstral|nemotron/i,
  thinking:/deepseek-r1|qwq|qwen3|gpt-oss|phi4-reasoning|magistral|cogito|openthinker/i,
  coder:/coder|codellama|starcoder|codestral|devstral|codegemma|granite-code|codeqwen/i
};

export function normalizeBaseUrl(url:string|undefined):string{
  return (url?.trim()||"http://127.0.0.1:11434").replace(/\/+$/,"");
}

export function parseParamsB(parameterSize:string|undefined,name:string):number{
  const fromDetails=/([\d.]+)\s*([BMK])\b/i.exec(parameterSize??"");
  const fromName=/:(?:[^:]*?)(\d+(?:\.\d+)?)([bm])(?![a-z])/i.exec(name);
  const m=fromDetails??fromName;
  if(!m||!m[1]||!m[2])return 0;
  const value=Number(m[1]);
  const unit=m[2].toUpperCase();
  return unit==="B"?value:unit==="M"?value/1000:value/1e6;
}

export function heuristicCapabilities(name:string,family=""):string[]{
  const id=`${name} ${family}`;
  if(RX.embedding.test(id))return["embedding"];
  const caps=["completion"];
  if(RX.tools.test(id))caps.push("tools");
  if(RX.vision.test(id))caps.push("vision");
  if(RX.thinking.test(id))caps.push("thinking");
  return caps;
}

async function requestJson(fetchImpl:FetchLike,url:string,body:unknown,timeoutMs:number):Promise<unknown>{
  const init:{method:string;headers:Record<string,string>;body?:string;signal:AbortSignal}={
    method:body===undefined?"GET":"POST",
    headers:{"content-type":"application/json"},
    signal:AbortSignal.timeout(timeoutMs)
  };
  if(body!==undefined)init.body=JSON.stringify(body);
  const res=await fetchImpl(url,init);
  const text=await res.text();
  if(!res.ok){
    let message=text;
    try{message=(JSON.parse(text) as {error?:string}).error??text;}catch{}
    throw new OllamaHttpError(res.status,message.slice(0,500)||`HTTP ${res.status}`);
  }
  return text?JSON.parse(text):{};
}
export {requestJson as ollamaRequestJson};

interface TagsResponse{models?:Array<{name?:string;model?:string;size?:number;details?:{family?:string;parameter_size?:string;quantization_level?:string}}>}
interface ShowResponse{capabilities?:string[];model_info?:Record<string,unknown>;details?:{family?:string;parameter_size?:string;quantization_level?:string}}

export interface DiscoverOptions{fetchImpl?:FetchLike;timeoutMs?:number;showConcurrency?:number}

export async function discoverOllama(baseUrl:string|undefined,options:DiscoverOptions={}):Promise<OllamaDiscovery>{
  const fetchImpl=options.fetchImpl??(fetch as unknown as FetchLike);
  const timeoutMs=options.timeoutMs??4000;
  const base=normalizeBaseUrl(baseUrl);
  const result:OllamaDiscovery={baseUrl:base,reachable:false,models:[],loaded:[],discoveredAt:new Date().toISOString()};
  try{
    const version=await requestJson(fetchImpl,base+"/api/version",undefined,timeoutMs) as {version?:string};
    result.reachable=true;
    if(version.version)result.version=version.version;
  }catch(error){
    result.error=`Ollama is not reachable at ${base}: ${(error as Error).message}`;
    return result;
  }
  let tags:TagsResponse;
  try{tags=await requestJson(fetchImpl,base+"/api/tags",undefined,timeoutMs) as TagsResponse;}
  catch(error){result.error=`Could not list Ollama models: ${(error as Error).message}`;return result;}
  try{
    const ps=await requestJson(fetchImpl,base+"/api/ps",undefined,timeoutMs) as {models?:Array<{name?:string}>};
    result.loaded=(ps.models??[]).map(m=>m.name??"").filter(Boolean);
  }catch{}

  const entries=(tags.models??[]).filter(m=>m.name||m.model);
  const queue=[...entries];
  const workers=Array.from({length:Math.max(1,options.showConcurrency??4)},async()=>{
    for(let entry=queue.shift();entry;entry=queue.shift()){
      const name=(entry.name??entry.model) as string;
      let show:ShowResponse={};
      try{show=await requestJson(fetchImpl,base+"/api/show",{model:name},Math.max(timeoutMs,8000)) as ShowResponse;}catch{}
      const details={...(entry.details??{}),...(show.details??{})};
      const reported=Array.isArray(show.capabilities)&&show.capabilities.length>0;
      let contextLength=0;
      for(const [key,value] of Object.entries(show.model_info??{}))
        if(key.endsWith(".context_length")&&typeof value==="number")contextLength=value;
      result.models.push({
        name,
        sizeBytes:typeof entry.size==="number"?entry.size:0,
        family:details.family??"",
        parameterSize:details.parameter_size??"",
        paramsB:parseParamsB(details.parameter_size,name),
        quantization:details.quantization_level??"",
        capabilities:reported?[...new Set(show.capabilities)]:heuristicCapabilities(name,details.family),
        capabilitySource:reported?"ollama":"heuristic",
        contextLength
      });
    }
  });
  await Promise.all(workers);
  result.models.sort((a,b)=>a.name.localeCompare(b.name));
  return result;
}

// ---------------------------------------------------------------- ranking

function sizeScore(paramsB:number):number{return paramsB?Math.min(paramsB,32)*0.9:6;}

function memoryPenalty(model:OllamaModelProfile,machine:MachineProfile):number{
  if(!model.sizeBytes||!machine.totalMemBytes)return 0;
  const ratio=model.sizeBytes/machine.totalMemBytes;
  if(ratio>0.75)return -200;
  if(ratio>0.55)return -25;
  if(ratio>0.4)return -6;
  return 0;
}

export function scoreModel(model:OllamaModelProfile,task:ModelTask,machine:MachineProfile,loaded:string[]=[]):number|null{
  const caps=new Set(model.capabilities);
  if(task==="embedding")
    return caps.has("embedding")?50+(/nomic|mxbai|bge|arctic/i.test(model.name)?5:0)-Math.min(model.paramsB,10):null;
  if(!caps.has("completion"))return null;
  if(task==="vision"&&!caps.has("vision"))return null;
  const tools=caps.has("tools"),thinking=caps.has("thinking"),coder=RX.coder.test(model.name);
  const size=sizeScore(model.paramsB);
  const bonus=memoryPenalty(model,machine)+(loaded.includes(model.name)?2:0);
  // Fully on the GPU is several times faster than spilling into system RAM.
  const fits=(machine.gpuVramBytes??0)>0&&model.sizeBytes>0&&model.sizeBytes<=(machine.gpuVramBytes??0)*0.9?3:0;
  switch(task){
    case "general":return size+(tools?12:0)-(coder?6:0)-(thinking?2:0)+fits+bonus;
    case "planning":return size*1.4+(tools?20:0)+(thinking?6:0)-(coder?3:0)+(model.contextLength>=16384?3:0)+fits/3+bonus;
    case "coding":return (coder?30:0)+size+(tools?6:0)+fits+bonus;
    case "vision":return 20+size+(tools?3:0)+fits+bonus;
    // Thinking is switched off for quick replies, so it only costs a little; coders make poor chat partners.
    case "fast":return 30-Math.min(model.paramsB||8,30)+(tools?6:0)-(thinking?3:0)-(coder?10:0)+fits+bonus;
  }
}

export function rankModels(models:OllamaModelProfile[],task:ModelTask,machine:MachineProfile=currentMachine(),loaded:string[]=[]):OllamaModelProfile[]{
  return models
    .map(model=>({model,score:scoreModel(model,task,machine,loaded)}))
    .filter((x):x is {model:OllamaModelProfile;score:number}=>x.score!==null)
    .sort((a,b)=>b.score-a.score||a.model.name.localeCompare(b.model.name))
    .map(x=>x.model);
}

export function findModel(models:OllamaModelProfile[],wanted:string|undefined):OllamaModelProfile|undefined{
  const name=wanted?.trim();
  if(!name)return undefined;
  return models.find(m=>m.name===name)
    ??models.find(m=>m.name===name+":latest")
    ??models.find(m=>m.name.startsWith(name+":"));
}

export interface ModelPlan{
  assignments:Record<ModelTask,string|null>;
  warnings:string[];
}

/** Pick one model per task. A pinned model is honoured only if it is actually installed. */
export function buildModelPlan(discovery:OllamaDiscovery,machine:MachineProfile=currentMachine(),pinned:Partial<Record<ModelTask,string>>={}):ModelPlan{
  const warnings:string[]=[];
  const assignments={} as Record<ModelTask,string|null>;
  for(const task of MODEL_TASKS){
    const pin=pinned[task];
    const pinnedModel=findModel(discovery.models,pin);
    if(pin&&pinnedModel&&scoreModel(pinnedModel,task,machine)!==null){assignments[task]=pinnedModel.name;continue;}
    if(pin)warnings.push(`Model "${pin}" for ${task} is not installed or not suitable; using the best installed model instead.`);
    assignments[task]=rankModels(discovery.models,task,machine,discovery.loaded)[0]?.name??null;
  }
  if(discovery.reachable&&discovery.models.length===0)warnings.push(`Ollama has no models installed. Run: ollama pull ${recommendedPull(machine)}`);
  return{assignments,warnings};
}

/**
 * Ollama's default context window is small (2048-4096 tokens depending on the
 * version). Agent prompts with tool catalogs and memory overflow it and get
 * silently truncated, which shows up as "incomplete plan" or random JSON.
 * Always send an explicit num_ctx that fits the model and the machine.
 */
export function recommendNumCtx(model:Pick<OllamaModelProfile,"contextLength"|"paramsB">&{sizeBytes?:number},machine:MachineProfile=currentMachine()):number{
  const ramGB=machine.totalMemBytes/2**30;
  let target=ramGB>=32?16384:ramGB>=12?8192:4096;
  if(model.paramsB>=30&&ramGB<64)target=Math.min(target,8192);
  const vram=machine.gpuVramBytes??0;
  if(vram>0&&model.sizeBytes){
    if(model.sizeBytes<=vram*0.9){
      // Keep weights + KV cache on the GPU (rough f16 KV estimate: ~16 KB per token per billion params).
      const kvPerToken=16*1024*Math.max(model.paramsB||7,1);
      const room=Math.floor((vram*0.92-model.sizeBytes)/kvPerToken/1024)*1024;
      target=Math.max(4096,Math.min(target,room));
    }else target=Math.min(target,8192); // already split CPU/GPU: a longer context only makes it slower
  }
  const max=model.contextLength||32768;
  return Math.max(2048,Math.min(target,max));
}

export function recommendedPull(machine:MachineProfile=currentMachine()):string{
  const ramGB=machine.totalMemBytes/2**30;
  return ramGB<12?"qwen3.5:4b":"qwen3.5:9b";
}
