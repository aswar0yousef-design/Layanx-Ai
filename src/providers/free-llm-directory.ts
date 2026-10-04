import {localSecret} from "../security/local-secret-vault.js";
import {FreeCapacityProvider,freeProviderRuntimeName,type FreeCapacitySpec} from "./free-capacity.js";

export interface FreeLlmDirectoryEntry extends FreeCapacitySpec{
  providerId:string;
  keyEnv:string;
  keyUrl:string;
  requiresKey:boolean;
  source:"open-free-llm-api/awesome-freellm-apis";
  lastVerified?:string;
}

export interface FreeLlmRuntimeEntry extends FreeLlmDirectoryEntry{
  configured:boolean;
  keySource:"vault"|"env"|"none";
}

export const FREE_LLM_DIRECTORY_SOURCE="https://github.com/open-free-llm-api/awesome-freellm-apis";

/**
 * Curated bootstrap catalog from the upstream directory.
 * It intentionally contains metadata and key-registration links only.
 * Secret API keys are never copied from GitHub or committed to this repository.
 *
 * The catalog is deliberately small and stable; the sync script can refresh
 * model metadata later without changing the runtime security boundary.
 */
export const FREE_LLM_DIRECTORY:FreeLlmDirectoryEntry[]=[
 {providerId:"groq",name:"Groq",baseUrl:"https://api.groq.com/openai/v1",keyEnv:"GROQ_API_KEY",keyUrl:"https://console.groq.com/keys",models:["moonshotai/kimi-k2-instruct","moonshotai/kimi-k2-instruct-0905","groq/compound"],capabilities:["chat","reasoning","coding"],priority:10,tags:["free","openai-compatible"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"nvidia-nim",name:"NVIDIA NIM",baseUrl:"https://integrate.api.nvidia.com/v1",keyEnv:"NVIDIA_API_KEY",keyUrl:"https://build.nvidia.com/",models:["z-ai/glm-5.3-flash","z-ai/glm-5.2","moonshotai/kimi-k2.6"],capabilities:["chat","reasoning","coding","vision"],priority:20,tags:["free","openai-compatible","long-context"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"openrouter",name:"OpenRouter",baseUrl:"https://openrouter.ai/api/v1",keyEnv:"OPENROUTER_API_KEY",keyUrl:"https://openrouter.ai/keys",models:["nvidia/nemotron-3-ultra-550b-a55b:free","poolside/laguna-m.1:free"],capabilities:["chat","reasoning","coding","vision"],priority:30,tags:["free","openai-compatible","aggregator"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"google-gemini",name:"Google Gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta",keyEnv:"GEMINI_API_KEY",keyUrl:"https://aistudio.google.com/apikey",models:["gemini-3.6-flash"],capabilities:["chat","reasoning","coding","vision","audio"],priority:40,tags:["free","google"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"mistral",name:"Mistral AI",baseUrl:"https://api.mistral.ai/v1",keyEnv:"MISTRAL_API_KEY",keyUrl:"https://console.mistral.ai/api-keys/",models:["open-mistral-7b","open-mixtral-8x7b","mistral-medium-3-5-128b"],capabilities:["chat","coding","vision"],priority:50,tags:["free","openai-compatible"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"cohere",name:"Cohere",baseUrl:"https://api.cohere.com/v2",keyEnv:"COHERE_API_KEY",keyUrl:"https://dashboard.cohere.com/api-keys",models:["command-a-218b","command-a-111b","command-r"],capabilities:["chat","vision"],priority:60,tags:["free"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"huggingface",name:"Hugging Face",baseUrl:"https://router.huggingface.co/v1",keyEnv:"HF_TOKEN",keyUrl:"https://huggingface.co/settings/tokens",models:["meta-llama/Llama-3.3-70B-Instruct"],capabilities:["chat","coding","vision"],priority:70,tags:["free","openai-compatible"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"cerebras",name:"Cerebras",baseUrl:"https://api.cerebras.ai/v1",keyEnv:"CEREBRAS_API_KEY",keyUrl:"https://cloud.cerebras.ai/",models:["llama-3.3-70b"],capabilities:["chat","reasoning","coding"],priority:80,tags:["free","openai-compatible","fast"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"zai",name:"Z AI",baseUrl:"https://open.bigmodel.cn/api/paas/v4",keyEnv:"ZAI_API_KEY",keyUrl:"https://open.bigmodel.cn/",models:["glm-4.7-flash","glm-4.6v-flash"],capabilities:["chat","reasoning","vision"],priority:90,tags:["free","openai-compatible"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"},
 {providerId:"github-models",name:"GitHub Models",baseUrl:"https://models.github.ai/inference",keyEnv:"GITHUB_TOKEN",keyUrl:"https://github.com/settings/tokens",models:["openai/gpt-oss-120b"],capabilities:["chat","reasoning","coding","vision"],priority:100,tags:["free","openai-compatible"],requiresKey:true,source:"open-free-llm-api/awesome-freellm-apis"}
];

function readKey(entry:FreeLlmDirectoryEntry):{value?:string;source:"vault"|"env"|"none"}{
 const vault=localSecret(entry.keyEnv);
 if(vault)return{value:vault,source:"vault"};
 const env=process.env[entry.keyEnv];
 if(env)return{value:env,source:"env"};
 return{source:"none"};
}

export function inspectFreeLlmDirectory():FreeLlmRuntimeEntry[]{
 return FREE_LLM_DIRECTORY.map(entry=>{
  const key=readKey(entry);
  return{...entry,configured:!entry.requiresKey||Boolean(key.value),keySource:key.source};
 });
}

export function createConfiguredFreeProviders():FreeCapacityProvider[]{
 return FREE_LLM_DIRECTORY.flatMap(entry=>{
  const key=readKey(entry);
  if(entry.requiresKey&&!key.value)return[];
  const spec:FreeCapacitySpec={
   name:entry.name,baseUrl:entry.baseUrl,apiKey:key.value,apiKeyEnv:entry.keyEnv,
   models:entry.models,capabilities:entry.capabilities,priority:entry.priority,tags:entry.tags
  };
  return[new FreeCapacityProvider({...spec,name:freeProviderRuntimeName(spec.name)})];
 });
}

export function freeLlmSetupLinks(){return FREE_LLM_DIRECTORY.map(entry=>({provider:entry.name,keyUrl:entry.keyUrl,keyEnv:entry.keyEnv,configured:inspectFreeLlmDirectory().find(x=>x.providerId===entry.providerId)?.configured??false}));}
