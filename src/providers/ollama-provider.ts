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

export function createOllamaProvider(options:OllamaProviderOptions={}){
 const root=(options.baseUrl??"http://127.0.0.1:11434").replace(/\/$/,"");
 const fetcher=options.fetcher??fetch;
 const autoSelect=options.autoSelectInstalledModel===true;
 const baseProvider=new HttpModelProvider({
  name:"ollama",baseUrl:root+"/api/chat",healthUrl:root+"/api/tags",timeoutMs:options.timeoutMs??30000,fetcher,
  buildBody:(model,request)=>({model:model.id,messages:[{role:"user",content:typeof request.input==="string"?request.input:request.input.filter(part=>part.type==="text").map(part=>part.text).join("\n"),...(typeof request.input==="string"?{}:{images:request.input.filter(part=>part.type==="image").map(part=>part.image.base64)})}],stream:false}),
  parseResponse:(body,model):ModelResponse=>{
   const data=body as {response?:string;message?:{content?:string};prompt_eval_count?:number;eval_count?:number};
   return{provider:"ollama",modelId:model.id,output:data.response??data.message?.content??"",usage:{inputTokens:data.prompt_eval_count,outputTokens:data.eval_count}};
  }
 });
 if(!autoSelect)return baseProvider;
 return{
  name:"ollama",
  async health(){return baseProvider.health();},
  async generate(model:ModelDefinition,request:ModelRequest){
   try{return await baseProvider.generate(model,request);}
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
    try{const result=await baseProvider.generate({...model,id:fallback},request);return{...result,modelId:model.id};}
    catch(retryError){throw new Error("Ollama could not run installed model '"+fallback+"'. "+(retryError instanceof Error?retryError.message:"request failed"));}
   }
  }
 };
}