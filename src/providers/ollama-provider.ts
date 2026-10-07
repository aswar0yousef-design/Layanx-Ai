import {HttpModelProvider} from "./http-model-provider.js";
import type {ModelResponse,ModelRequest} from "../models/inference.js";
import type {ModelDefinition} from "../models/registry.js";

interface OllamaTagResponse{models?:Array<{name?:string;model?:string}>}
export interface OllamaProviderOptions{baseUrl?:string;timeoutMs?:number;fetcher?:typeof fetch;autoSelectInstalledModel?:boolean;}

function fallbackModel(requested:string,installed:string[]){
 const exact=installed.find(name=>name===requested);if(exact)return exact;
 const base=(requested.split(":")[0]??"").toLowerCase();
 const family=installed.find(name=>(name.split(":")[0]??"").toLowerCase()===base);if(family)return family;
 return installed.find(name=>!/(embed|nomic-embed|bge-m3|snowflake-arctic-embed)/i.test(name));
}

/**
 * Ollama's default context window (2048-4096 tokens) silently truncates agent
 * prompts that carry a tool catalog and memory. The local host writes the right
 * size per installed model into LAYANX_OLLAMA_CONTEXT (JSON map); fall back to
 * LAYANX_OLLAMA_NUM_CTX, then 8192.
 */
export function ollamaNumCtx(modelId:string,env:NodeJS.ProcessEnv=process.env):number{
 try{const map=JSON.parse(env.LAYANX_OLLAMA_CONTEXT??"{}") as Record<string,unknown>;const v=map[modelId];if(typeof v==="number"&&v>=1024)return Math.floor(v);}catch{}
 const fallback=Number(env.LAYANX_OLLAMA_NUM_CTX);
 return Number.isFinite(fallback)&&fallback>=1024?Math.floor(fallback):8192;
}

/**
 * Thinking models (qwen3.5, deepseek-r1, gemma4, gpt-oss...) can spend hundreds of
 * tokens reasoning before every answer: on a 6 GB GPU that is tens of seconds per
 * step. The local host lists them in LAYANX_OLLAMA_THINKING_MODELS; thinking stays
 * off for them unless LAYANX_OLLAMA_THINK=on.
 */
export function ollamaThinkingOff(modelId:string,env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.LAYANX_OLLAMA_THINK==="on")return false;
 return (env.LAYANX_OLLAMA_THINKING_MODELS??"").split(",").map(v=>v.trim()).includes(modelId);
}
/**
 * gpt-oss always reasons and takes a level instead of true/false: "low" keeps it fast,
 * LAYANX_OLLAMA_THINK=on gives "medium" for harder planning. Other thinking models: off unless on.
 */
export function ollamaThinkOption(modelId:string,env:NodeJS.ProcessEnv=process.env):{think?:boolean|"low"|"medium"|"high"}{
 if(/^gpt-oss/i.test(modelId))return{think:env.LAYANX_OLLAMA_THINK==="on"?"medium":"low"};
 return ollamaThinkingOff(modelId,env)?{think:false}:{};
}
const THINK_BLOCK=/<think>[\s\S]*?<\/think>/gi;

/**
 * Structured outputs: when the caller supplies a JSON Schema, Ollama constrains decoding to it,
 * so a 4B/9B model cannot return a malformed plan. LAYANX_OLLAMA_STRUCTURED=off falls back to plain JSON mode.
 */
export function ollamaFormat(request:ModelRequest,env:NodeJS.ProcessEnv=process.env):{format?:"json"|Record<string,unknown>}{
 if(request.responseSchema&&env.LAYANX_OLLAMA_STRUCTURED!=="off")return{format:request.responseSchema};
 return(request.capability==="reasoning"||request.capability==="vision")?{format:"json"}:{};
}

/**
 * Output cap: an explicit maxOutputTokens, else 1024 tokens for JSON answers (plans and tool choices are far
 * shorter). Small models in JSON mode sometimes emit endless whitespace until the context is full; without a
 * cap one planning step could run for minutes. LAYANX_OLLAMA_NUM_PREDICT changes the JSON cap.
 */
export function ollamaNumPredict(request:ModelRequest,env:NodeJS.ProcessEnv=process.env):number|undefined{
 if(typeof request.maxOutputTokens==="number"&&request.maxOutputTokens>0)return Math.floor(request.maxOutputTokens);
 if(!ollamaFormat(request,env).format)return undefined;
 const configured=Number(env.LAYANX_OLLAMA_NUM_PREDICT);
 return Number.isFinite(configured)&&configured>=64?Math.floor(configured):1024;
}

/** Older Ollama builds reject some schema keywords; retry the same request once in plain JSON mode. */
function withoutSchema(request:ModelRequest):ModelRequest{const{responseSchema:_ignored,...rest}=request;return rest;}


export function createOllamaProvider(options:OllamaProviderOptions={}){
 const root=(options.baseUrl??"http://127.0.0.1:11434").replace(/\/$/,"");
 const fetcher=options.fetcher??fetch;
 const autoSelect=options.autoSelectInstalledModel===true;
 const baseProvider=new HttpModelProvider({
  name:"ollama",baseUrl:root+"/api/chat",healthUrl:root+"/api/tags",timeoutMs:options.timeoutMs??(Number(process.env.OLLAMA_TIMEOUT_MS)||180000),fetcher,
  buildBody:(model,request)=>({model:model.id,messages:[{role:"user",content:typeof request.input==="string"?request.input:request.input.filter(part=>part.type==="text").map(part=>part.text).join("\n"),...(typeof request.input==="string"?{}:{images:request.input.filter(part=>part.type==="image").map(part=>part.image.base64)})}],stream:false,keep_alive:process.env.OLLAMA_KEEP_ALIVE??"10m",options:{num_ctx:ollamaNumCtx(model.id),...(ollamaNumPredict(request)?{num_predict:ollamaNumPredict(request)}:{})},...ollamaThinkOption(model.id),...ollamaFormat(request)}),
  parseResponse:(body,model):ModelResponse=>{
   const data=body as {response?:string;message?:{content?:string};prompt_eval_count?:number;eval_count?:number};
   return{provider:"ollama",modelId:model.id,output:(data.response??data.message?.content??"").replace(THINK_BLOCK,"").trim(),usage:{inputTokens:data.prompt_eval_count,outputTokens:data.eval_count}};
  }
 });
 const schemaAware={
  name:"ollama",
  async health(){return baseProvider.health();},
  async generate(model:ModelDefinition,request:ModelRequest):Promise<ModelResponse>{
   try{return await baseProvider.generate(model,request);}
   catch(error){
    const message=error instanceof Error?error.message:"";
    if(!request.responseSchema||!/HTTP (400|422|500)/.test(message))throw error;
    return baseProvider.generate(model,withoutSchema(request));
   }
  }
 };
 if(!autoSelect)return schemaAware;
 return{
  name:"ollama",
  async health(){return baseProvider.health();},
  async generate(model:ModelDefinition,request:ModelRequest){
   try{return await schemaAware.generate(model,request);}
   catch(error){
    const message=error instanceof Error?error.message:"Ollama request failed.";
    if(!/HTTP 404/.test(message))throw error;
    let response:Response;
    try{response=await fetcher(root+"/api/tags",{method:"GET",redirect:"error"});}
    catch{throw new Error("Ollama is running but the requested model '"+model.id+"' was not found. Run ollama list and install a model, for example: ollama pull llama3.2:3b.");}
    if(!response.ok)throw new Error("Ollama is running but its model list could not be read (HTTP "+response.status+").");
    const body=await response.json() as OllamaTagResponse;
    const installed=(body.models??[]).map(item=>item.name??item.model??"").filter(Boolean);
    const fallback=fallbackModel(model.id,installed);
    if(!fallback)throw new Error("Ollama has no installed text model. Run ollama list and install one, for example: ollama pull llama3.2:3b.");
    try{const result=await schemaAware.generate({...model,id:fallback},request);return{...result,modelId:model.id};}
    catch(retryError){throw new Error("Ollama could not run installed model '"+fallback+"'. "+(retryError instanceof Error?retryError.message:"request failed"));}
   }
  }
 };
}