import {HttpModelProvider} from "./http-model-provider.js";
import type {ModelResponse} from "../models/inference.js";
export function createGeminiProvider(options:{apiKey:string;baseUrl?:string;healthUrl?:string;timeoutMs?:number;fetcher?:typeof fetch}){
 const root=(options.baseUrl??"https://generativelanguage.googleapis.com/v1beta").replace(/\/$/,"");
 const health=options.healthUrl??root+"/models";
 return new HttpModelProvider({
  name:"gemini",baseUrl:root,healthUrl:health,timeoutMs:options.timeoutMs??30000,fetcher:options.fetcher,
  headers:{"x-goog-api-key":options.apiKey},
  buildUrl:(model)=>root+"/models/"+encodeURIComponent(model.id)+":generateContent",
  buildHealthUrl:()=>health,
  buildBody:(_model,request)=>({contents:[{role:"user",parts:[{text:request.input}]}],generationConfig:{maxOutputTokens:request.maxOutputTokens}}),
  parseResponse:(body,model):ModelResponse=>{const data=body as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>;usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number}};const output=(data.candidates??[]).flatMap(candidate=>candidate.content?.parts??[]).map(part=>part.text??"").join("");return{provider:"gemini",modelId:model.id,output,usage:{inputTokens:data.usageMetadata?.promptTokenCount,outputTokens:data.usageMetadata?.candidatesTokenCount}};}
 });
}
