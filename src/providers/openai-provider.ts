import {HttpModelProvider} from "./http-model-provider.js";
import type {ModelResponse} from "../models/inference.js";
import type {ModelDefinition} from "../models/registry.js";

export function createOpenAIProvider(options:{apiKey:string;baseUrl?:string;timeoutMs?:number;fetcher?:typeof fetch}){
 return new HttpModelProvider({
  name:"openai",
  baseUrl:options.baseUrl??"https://api.openai.com/v1/responses",
  healthUrl:(options.baseUrl??"https://api.openai.com/v1").replace(/\/$/,"")+"/models",
  apiKey:options.apiKey,
  timeoutMs:options.timeoutMs,
  fetcher:options.fetcher,
  buildBody:(model,request)=>({model:model.id,input:request.input,max_output_tokens:request.maxOutputTokens}),
  parseResponse:(body,model):ModelResponse=>{
   const data=body as {output_text?:string;usage?:{input_tokens?:number;output_tokens?:number}};
   return{provider:"openai",model:model.id,modelId:model.id,output:data.output_text??"",usage:{inputTokens:data.usage?.input_tokens,outputTokens:data.usage?.output_tokens}};
  }
 });
}