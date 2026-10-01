import {ModelRegistry} from "../models/registry.js";
import {ModelProviderRegistry} from "../core/model-execution.js";
import {createOpenAIProvider} from "../providers/openai-provider.js";
import {createOllamaProvider} from "../providers/ollama-provider.js";

export type ProviderMode="local"|"cloud"|"hybrid";

export interface ProviderRuntimeConfig{
 mode:ProviderMode;
 ollama:{enabled:boolean;baseUrl:string;model:string};
 openai:{enabled:boolean;apiKey?:string;baseUrl:string;healthUrl:string;model:string};
}

export function loadProviderConfig(env:NodeJS.ProcessEnv=process.env):ProviderRuntimeConfig{
 const mode=(env.LAYANX_AI_MODE??"local") as ProviderMode;
 if(!["local","cloud","hybrid"].includes(mode))throw new Error("Invalid LAYANX_AI_MODE.");
 return{
  mode,
  ollama:{
   enabled:env.OLLAMA_ENABLED!=="false",
   baseUrl:env.OLLAMA_BASE_URL??"http://127.0.0.1:11434",
   model:env.OLLAMA_MODEL??"llama3.2:3b"
  },
  openai:{
   enabled:env.OPENAI_ENABLED==="true",
   apiKey:env.OPENAI_API_KEY,
   baseUrl:env.OPENAI_BASE_URL??"https://api.openai.com/v1/responses",
   healthUrl:env.OPENAI_HEALTH_URL??"https://api.openai.com/v1/models",
   model:env.OPENAI_MODEL??"gpt-5.6-luna"
  }
 };
}

export function configureProviders(config=loadProviderConfig(),models=new ModelRegistry(),providers=new ModelProviderRegistry()){
 const allowLocal=config.mode==="local"||config.mode==="hybrid";
 const allowCloud=config.mode==="cloud"||config.mode==="hybrid";
 if(config.ollama.enabled&&allowLocal){
  providers.register(createOllamaProvider({baseUrl:config.ollama.baseUrl}));
  models.register({id:config.ollama.model,provider:"ollama",capabilities:["chat","reasoning","coding"],local:true,enabled:true,priority:1});
 }
 if(config.openai.enabled&&allowCloud&&config.openai.apiKey){
  providers.register(createOpenAIProvider({apiKey:config.openai.apiKey,baseUrl:config.openai.baseUrl,healthUrl:config.openai.healthUrl}));
  models.register({id:config.openai.model,provider:"openai",capabilities:["chat","reasoning","coding","vision"],local:false,enabled:true,priority:10});
 }
 return{models,providers};
}

export function providerSummary(config=loadProviderConfig()){
 return{
  mode:config.mode,
  ollama:{enabled:config.ollama.enabled,baseUrl:config.ollama.baseUrl,model:config.ollama.model},
  openai:{enabled:config.openai.enabled,configured:Boolean(config.openai.apiKey),baseUrl:config.openai.baseUrl,healthUrl:config.openai.healthUrl,model:config.openai.model}
 };
}
