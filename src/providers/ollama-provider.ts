import {HttpModelProvider} from "./http-model-provider.js";
import type {ModelResponse} from "../models/inference.js";

export function createOllamaProvider(options:{baseUrl?:string;timeoutMs?:number;fetcher?:typeof fetch}){
 const root=(options.baseUrl??"http://127.0.0.1:11434").replace(/\/$/,"");
 return new HttpModelProvider({
  name:"ollama",
  baseUrl:root+"/api/chat",
  healthUrl:root+"/api/tags",
  timeoutMs:options.timeoutMs??30000,
  fetcher:options.fetcher,
  buildBody:(model,request)=>({model:model.id,messages:[{role:"user",content:typeof request.input==="string"?request.input:request.input.filter(part=>part.type==="text").map(part=>part.text).join("\n"),...(typeof request.input==="string"?{}:{images:request.input.filter(part=>part.type==="image").map(part=>part.image.base64)})}],stream:false}),
  parseResponse:(body,model):ModelResponse=>{
   const data=body as {response?:string;message?:{content?:string};prompt_eval_count?:number;eval_count?:number};
   return{provider:"ollama",modelId:model.id,output:data.response??data.message?.content??"",usage:{inputTokens:data.prompt_eval_count,outputTokens:data.eval_count}};
  }
 });
}