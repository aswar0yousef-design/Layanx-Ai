import {HttpModelProvider} from "./http-model-provider.js";
import type {ModelResponse} from "../models/inference.js";
export function createAnthropicProvider(options:{apiKey:string;baseUrl?:string;healthUrl?:string;timeoutMs?:number;fetcher?:typeof fetch}){
 const root=(options.baseUrl??"https://api.anthropic.com/v1/messages").replace(/\/$/,"");
 const health=options.healthUrl??"https://api.anthropic.com/v1/models";
 return new HttpModelProvider({
  name:"anthropic",baseUrl:root,healthUrl:health,apiKey:options.apiKey,timeoutMs:options.timeoutMs,fetcher:options.fetcher,
  headers:{"x-api-key":options.apiKey,"anthropic-version":"2023-06-01"},
  buildBody:(model,request)=>({model:model.id,max_tokens:request.maxOutputTokens??1024,messages:[{role:"user",content:typeof request.input==="string"?request.input:request.input.map(part=>part.type==="text"?{type:"text",text:part.text}:{type:"image",source:{type:"base64",media_type:part.image.mimeType,data:part.image.base64}})}]}),
  parseResponse:(body,model):ModelResponse=>{const data=body as {content?:Array<{type?:string;text?:string}>;usage?:{input_tokens?:number;output_tokens?:number}};return{provider:"anthropic",modelId:model.id,output:data.content?.find(part=>part.type==="text")?.text??"",usage:{inputTokens:data.usage?.input_tokens,outputTokens:data.usage?.output_tokens}};}
 });
}
