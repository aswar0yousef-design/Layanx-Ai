import {HttpModelProvider} from "./http-model-provider.js";
import type {ModelResponse} from "../models/inference.js";

export function createOllamaProvider(options:{baseUrl?:string;timeoutMs?:number;fetcher?:typeof fetch}){
 const root=(options.baseUrl??"http://127.0.0.1:11434").replace(/\\/$/,"");
 return new HttpModelProvider({
  name:"ollama",
  baseUrl:root+"/api/generate",
  healthUrl:root+"/api/tags",
  timeoutMs:options.timeoutMs??30000,
  fetcher:options.fetcher,
  buildBody:(model,request)=>({model:model.id,prompt:request.input,stream:false}),
  parseResponse:(body,model):ModelResponse=>{
   const data=body as {response?:string;prompt_eval_count?:number;eval_count?:number};
   return{provider:"ollama",model:model.id,modelId:model.id,output:data.response??"",usage:{inputTokens:data.prompt_eval_count,outputTokens:data.eval_count}};
  }
 });
}