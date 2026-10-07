import {HttpModelProvider} from "./http-model-provider.js";
import type {ModelResponse} from "../models/inference.js";
import type {ModelDefinition} from "../models/registry.js";

export function createOpenAIProvider(options:{apiKey:string;baseUrl?:string;healthUrl?:string;timeoutMs?:number;fetcher?:typeof fetch}){
 return new HttpModelProvider({
  name:"openai",
  baseUrl:options.baseUrl??"https://api.openai.com/v1/responses",
  healthUrl:options.healthUrl??"https://api.openai.com/v1/models",
  apiKey:options.apiKey,
  timeoutMs:options.timeoutMs,
  fetcher:options.fetcher,
  buildBody:(model,request)=>{const input:unknown=typeof request.input==="string"?request.input:[{role:"user",content:request.input.map(part=>part.type==="text"?{type:"input_text",text:part.text}:{type:"input_image",image_url:`data:${part.image.mimeType};base64,${part.image.base64}`})}];return{model:model.id,input,max_output_tokens:request.maxOutputTokens};},
  parseResponse:(body,model):ModelResponse=>{
   // The REST Responses API returns text inside output[].content[] (output_text is only an SDK helper).
   const data=body as {output_text?:string;output?:Array<{type?:string;content?:Array<{type?:string;text?:string}>}>;usage?:{input_tokens?:number;output_tokens?:number}};
   const text=data.output_text??(data.output??[]).flatMap(item=>item.content??[]).filter(part=>part.type==="output_text"&&typeof part.text==="string").map(part=>part.text).join("");
   return{provider:"openai",modelId:model.id,output:text,usage:{inputTokens:data.usage?.input_tokens,outputTokens:data.usage?.output_tokens}};
  }
 });
}