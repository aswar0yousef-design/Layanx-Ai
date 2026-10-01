import {loadProviderConfig,providerSummary} from "./config/providers.js";

export interface ProviderDoctorResult{provider:string;configured:boolean;reachable:boolean;model?:string;modelAvailable?:boolean;reason?:string;}
function ollamaTagsUrl(baseUrl:string){return baseUrl.replace(/\/$/,"")+"/api/tags";}
export async function providerDoctor(fetcher:typeof fetch=fetch):Promise<{ok:boolean;providers:ProviderDoctorResult[]}>{
 const config=loadProviderConfig(); const results:ProviderDoctorResult[]=[];
 if(config.ollama.enabled&&(config.mode==="local"||config.mode==="hybrid")){
  try{const response=await fetcher(ollamaTagsUrl(config.ollama.baseUrl),{method:"GET"}); if(!response.ok)throw new Error("Ollama returned HTTP "+response.status); const body=await response.json() as {models?:Array<{name?:string}>}; const names=(body.models??[]).map(model=>model.name).filter((name):name is string=>Boolean(name)); const modelAvailable=names.includes(config.ollama.model)||names.some(name=>name.startsWith(config.ollama.model+":")); results.push({provider:"ollama",configured:true,reachable:true,model:config.ollama.model,modelAvailable,reason:modelAvailable?undefined:"Configured model is not installed."});}
  catch(error){results.push({provider:"ollama",configured:true,reachable:false,model:config.ollama.model,modelAvailable:false,reason:error instanceof Error?error.message:"Ollama is unreachable."});}
 }
 if(config.openai.enabled&&(config.mode==="cloud"||config.mode==="hybrid")) results.push({provider:"openai",configured:Boolean(config.openai.apiKey),reachable:false,model:config.openai.model,reason:config.openai.apiKey?"Run layanx health to verify the configured cloud endpoint.":"OpenAI API key is not configured."});
 return {ok:results.length>0&&results.every(result=>result.reachable&&(result.modelAvailable??true)),providers:results};
}
export function doctorSummary(){return providerSummary();}
