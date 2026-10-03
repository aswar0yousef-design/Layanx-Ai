import {ModelRegistry} from "../models/registry.js";
import {ModelProviderRegistry} from "../core/model-execution.js";
import {createOpenAIProvider} from "../providers/openai-provider.js";
import {createOllamaProvider} from "../providers/ollama-provider.js";
import {createAnthropicProvider} from "../providers/anthropic-provider.js";
import {createGeminiProvider} from "../providers/gemini-provider.js";
import {FreeCapacityProvider,type FreeCapacitySpec} from "../providers/free-capacity.js";
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
 if(!enabled||!existsSync(configPath))return{enabled,configPath,providers:[] as FreeCapacitySpec[]};
 try{
  const parsed=JSON.parse(readFileSync(configPath,"utf8")) as {providers?:FreeCapacitySpec[]};
  if(!Array.isArray(parsed.providers))throw new Error("free provider config must contain a providers array");
  const providers=parsed.providers.map((item,index)=>{
   if(!item.name||!item.baseUrl||!Array.isArray(item.models)||!item.models.length)throw new Error("Invalid free provider entry at index "+index);
   return{...item,apiKey:item.apiKey??(item.apiKeyEnv?env[item.apiKeyEnv]:undefined)};
  });
  return{enabled,configPath,providers};
 }catch(error){throw new Error("Invalid LAYANX_FREE_POOL_CONFIG: "+(error instanceof Error?error.message:"unable to read config"));}
}
export function loadProviderConfig(env:NodeJS.ProcessEnv=process.env):ProviderRuntimeConfig{
 const mode=(env.LAYANX_AI_MODE??"local") as ProviderMode;if(!["local","cloud","hybrid"].includes(mode))throw new Error("Invalid LAYANX_AI_MODE.");
 return{mode,
  ollama:{enabled:env.OLLAMA_ENABLED!=="false",baseUrl:env.OLLAMA_BASE_URL??"http://127.0.0.1:11434",model:env.OLLAMA_MODEL??"llama3.2:3b",visionModel:env.OLLAMA_VISION_MODEL??"moondream:1.8b"},
  openai:{enabled:env.OPENAI_ENABLED==="true",apiKey:env.OPENAI_API_KEY,baseUrl:env.OPENAI_BASE_URL??"https://api.openai.com/v1/responses",healthUrl:env.OPENAI_HEALTH_URL??"https://api.openai.com/v1/models",model:env.OPENAI_MODEL??"gpt-5.6-luna"},
  anthropic:{enabled:env.ANTHROPIC_ENABLED==="true",apiKey:env.ANTHROPIC_API_KEY,baseUrl:env.ANTHROPIC_BASE_URL??"https://api.anthropic.com/v1/messages",healthUrl:env.ANTHROPIC_HEALTH_URL??"https://api.anthropic.com/v1/models",model:env.ANTHROPIC_MODEL??"claude-sonnet-4-5"},
  gemini:{enabled:env.GEMINI_ENABLED==="true",apiKey:env.GEMINI_API_KEY,baseUrl:env.GEMINI_BASE_URL??"https://generativelanguage.googleapis.com/v1beta",healthUrl:env.GEMINI_HEALTH_URL??"https://generativelanguage.googleapis.com/v1beta/models",model:env.GEMINI_MODEL??"gemini-3.6-flash"},
  freePool:loadFreePool(env)
 };
}
export function configureProviders(config=loadProviderConfig(),models=new ModelRegistry(),providers=new ModelProviderRegistry()){
 const allowLocal=config.mode==="local"||config.mode==="hybrid";const allowCloud=config.mode==="cloud"||config.mode==="hybrid";
 if(config.ollama.enabled&&allowLocal){providers.register(createOllamaProvider({baseUrl:config.ollama.baseUrl}));models.register({id:config.ollama.model,provider:"ollama",capabilities:["chat","reasoning","coding"],local:true,enabled:true,priority:1});
   if(config.ollama.visionModel&&config.ollama.visionModel!==config.ollama.model)models.register({id:config.ollama.visionModel,provider:"ollama",capabilities:["vision"],local:true,enabled:true,priority:2,tags:["computer-use","vision"]});}
 let priority=10;
 if(config.openai.enabled&&allowCloud&&config.openai.apiKey){providers.register(createOpenAIProvider({apiKey:config.openai.apiKey,baseUrl:config.openai.baseUrl,healthUrl:config.openai.healthUrl}));models.register({id:config.openai.model,provider:"openai",capabilities:["chat","reasoning","coding","vision"],local:false,enabled:true,priority:priority++});}
 if(config.anthropic.enabled&&allowCloud&&config.anthropic.apiKey){providers.register(createAnthropicProvider({apiKey:config.anthropic.apiKey,baseUrl:config.anthropic.baseUrl,healthUrl:config.anthropic.healthUrl}));models.register({id:config.anthropic.model,provider:"anthropic",capabilities:["chat","reasoning","coding","vision"],local:false,enabled:true,priority:priority++});}
 if(config.gemini.enabled&&allowCloud&&config.gemini.apiKey){providers.register(createGeminiProvider({apiKey:config.gemini.apiKey,baseUrl:config.gemini.baseUrl,healthUrl:config.gemini.healthUrl}));models.register({id:config.gemini.model,provider:"gemini",capabilities:["chat","reasoning","coding","vision","audio"],local:false,enabled:true,priority:priority++});}
 if(config.freePool.enabled){
  for(const spec of config.freePool.providers){
   const provider=new FreeCapacityProvider(spec);providers.register(provider);
   const capabilities=spec.capabilities??["chat","reasoning","coding"];const providerPriority=spec.priority??priority++;
   for(const providerModelId of spec.models){
    const id="free:"+spec.name+":"+providerModelId;
    models.register({id,provider:spec.name,providerModelId,capabilities,local:false,enabled:true,priority:providerPriority,costPer1kInputUsd:0,costPer1kOutputUsd:0,tags:[...(spec.tags??[]),"free"]});
   }
  }
 }
 return{models,providers};
}
export function providerSummary(config=loadProviderConfig()){
 return{mode:config.mode,
  ollama:{enabled:config.ollama.enabled,baseUrl:config.ollama.baseUrl,model:config.ollama.model,visionModel:config.ollama.visionModel},
  openai:{enabled:config.openai.enabled,configured:Boolean(config.openai.apiKey),baseUrl:config.openai.baseUrl,healthUrl:config.openai.healthUrl,model:config.openai.model},
  anthropic:{enabled:config.anthropic.enabled,configured:Boolean(config.anthropic.apiKey),baseUrl:config.anthropic.baseUrl,healthUrl:config.anthropic.healthUrl,model:config.anthropic.model},
  gemini:{enabled:config.gemini.enabled,configured:Boolean(config.gemini.apiKey),baseUrl:config.gemini.baseUrl,healthUrl:config.gemini.healthUrl,model:config.gemini.model},
  freePool:{enabled:config.freePool.enabled,configPath:config.freePool.configPath,providers:config.freePool.providers.map(provider=>({name:provider.name,baseUrl:provider.baseUrl,models:provider.models,capabilities:provider.capabilities??["chat","reasoning","coding"],priority:provider.priority??null,dailyTokenLimit:provider.dailyTokenLimit??null,monthlyTokenLimit:provider.monthlyTokenLimit??null,tags:provider.tags??[]}))}};
}
