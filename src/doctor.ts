import {loadProviderConfig,providerSummary} from "./config/providers.js";
import {createOpenAIProvider} from "./providers/openai-provider.js";
import {createAnthropicProvider} from "./providers/anthropic-provider.js";
import {createGeminiProvider} from "./providers/gemini-provider.js";

export interface ProviderDoctorResult{
  provider:string;
  configured:boolean;
  reachable:boolean;
  model?:string;
  modelAvailable?:boolean;
  reason?:string;
}

function ollamaTagsUrl(baseUrl:string){return baseUrl.replace(/\/$/,"")+"/api/tags";}

async function cloudHealth(
  provider:"openai"|"anthropic"|"gemini",
  config:ReturnType<typeof loadProviderConfig>,
  fetcher:typeof fetch
):Promise<ProviderDoctorResult>{
  if(provider==="openai"){
    if(!config.openai.enabled)return{provider,configured:false,reachable:false,model:config.openai.model,reason:"OpenAI is disabled."};
    if(!config.openai.apiKey)return{provider,configured:false,reachable:false,model:config.openai.model,reason:"OpenAI API key is not configured."};
    const health=await createOpenAIProvider({
      apiKey:config.openai.apiKey,
      baseUrl:config.openai.baseUrl,
      healthUrl:config.openai.healthUrl,
      fetcher
    }).health();
    return{provider,configured:true,reachable:health.available,model:config.openai.model,reason:health.reason};
  }
  if(provider==="anthropic"){
    if(!config.anthropic.enabled)return{provider,configured:false,reachable:false,model:config.anthropic.model,reason:"Anthropic is disabled."};
    if(!config.anthropic.apiKey)return{provider,configured:false,reachable:false,model:config.anthropic.model,reason:"Anthropic API key is not configured."};
    const health=await createAnthropicProvider({
      apiKey:config.anthropic.apiKey,
      baseUrl:config.anthropic.baseUrl,
      healthUrl:config.anthropic.healthUrl,
      fetcher
    }).health();
    return{provider,configured:true,reachable:health.available,model:config.anthropic.model,reason:health.reason};
  }
  if(!config.gemini.enabled)return{provider,configured:false,reachable:false,model:config.gemini.model,reason:"Gemini is disabled."};
  if(!config.gemini.apiKey)return{provider,configured:false,reachable:false,model:config.gemini.model,reason:"Gemini API key is not configured."};
  const health=await createGeminiProvider({
    apiKey:config.gemini.apiKey,
    baseUrl:config.gemini.baseUrl,
    healthUrl:config.gemini.healthUrl,
    fetcher
  }).health();
  return{provider,configured:true,reachable:health.available,model:config.gemini.model,reason:health.reason};
}

export async function providerDoctor(fetcher:typeof fetch=fetch):Promise<{ok:boolean;providers:ProviderDoctorResult[]}>{
 const config=loadProviderConfig();
 const results:ProviderDoctorResult[]=[];

 if(config.ollama.enabled&&(config.mode==="local"||config.mode==="hybrid")){
  try{
   const response=await fetcher(ollamaTagsUrl(config.ollama.baseUrl),{method:"GET"});
   if(!response.ok)throw new Error("Ollama returned HTTP "+response.status);
   const body=await response.json() as {models?:Array<{name?:string}>};
   const names=(body.models??[]).map(model=>model.name).filter((name):name is string=>Boolean(name));
   const modelAvailable=names.includes(config.ollama.model)||names.some(name=>name.startsWith(config.ollama.model+":"));
   results.push({
    provider:"ollama",configured:true,reachable:true,model:config.ollama.model,modelAvailable,
    reason:modelAvailable?undefined:"Configured model is not installed."
   });
  }catch(error){
   results.push({
    provider:"ollama",configured:true,reachable:false,model:config.ollama.model,modelAvailable:false,
    reason:error instanceof Error?error.message:"Ollama is unreachable."
   });
  }
 }

 if(config.mode==="cloud"||config.mode==="hybrid"){
  for(const provider of ["openai","anthropic","gemini"] as const){
   results.push(await cloudHealth(provider,config,fetcher));
  }
 }

 return{
  ok:results.length>0&&results.every(result=>result.reachable&&(result.modelAvailable??true)),
  providers:results
 };
}

export function doctorSummary(){return providerSummary();}
