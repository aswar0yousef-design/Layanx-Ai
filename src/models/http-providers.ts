import type {ModelDefinition} from "./registry.js";
import type {ModelProviderAdapter,ModelRequest,ModelResponse} from "./inference.js";

export interface FetchLike{
  (input:RequestInfo|URL,init?:RequestInit):Promise<Response>;
}

export interface OpenAICompatibleProviderOptions{
  name:string;
  baseUrl:string;
  apiKey?:()=>Promise<string>|string;
  fetcher?:FetchLike;
  timeoutMs?:number;
}

export class OpenAICompatibleProvider implements ModelProviderAdapter{
  readonly name:string;
  private readonly baseUrl:string;
  private readonly apiKey?:()=>Promise<string>|string;
  private readonly fetcher:FetchLike;
  private readonly timeoutMs:number;
  constructor(options:OpenAICompatibleProviderOptions){
    this.name=options.name;
    this.baseUrl=options.baseUrl.replace(/\/$/,"");
    this.apiKey=options.apiKey;
    this.fetcher=options.fetcher??fetch;
    this.timeoutMs=options.timeoutMs??30000;
  }
  async health(){
    const started=Date.now();
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try{
        const response=await this.fetcher(this.baseUrl,{method:"GET",signal:controller.signal});
        return{provider:this.name,available:response.ok||response.status===401||response.status===404,latencyMs:Date.now()-started,reason:response.ok?undefined:"provider endpoint reachable",updatedAt:new Date().toISOString()};
      }finally{clearTimeout(timer);}
    }catch(error){
      return{provider:this.name,available:false,latencyMs:Date.now()-started,reason:error instanceof Error?error.message:"Provider health check failed",updatedAt:new Date().toISOString()};
    }
  }
  async generate(model:ModelDefinition,request:ModelRequest):Promise<ModelResponse>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const key=typeof this.apiKey==="function"?await this.apiKey():this.apiKey;
      const response=await this.fetcher(this.baseUrl+"/chat/completions",{
        method:"POST",
        headers:{"content-type":"application/json",...(key?{"authorization":"Bearer "+key}: {})},
        body:JSON.stringify({model:model.id,messages:[{role:"user",content:request.input}],max_tokens:request.maxOutputTokens}),
        signal:controller.signal
      });
      const raw=await response.text();
      if(!response.ok)throw new Error(this.name+" request failed ("+response.status+").");
      let data:{choices?:Array<{message?:{content?:unknown}}>;usage?:{prompt_tokens?:number;completion_tokens?:number}};
      try{data=JSON.parse(raw);}catch{throw new Error(this.name+" returned invalid JSON.");}
      const output=data.choices?.[0]?.message?.content;
      if(typeof output!=="string")throw new Error(this.name+" returned no text content.");
      return{modelId:model.id,provider:this.name,output,usage:{inputTokens:data.usage?.prompt_tokens,outputTokens:data.usage?.completion_tokens}};
    }finally{clearTimeout(timer);}
  }
}

export interface OllamaProviderOptions{name?:string;baseUrl:string;fetcher?:FetchLike;timeoutMs?:number;}
export class OllamaProvider implements ModelProviderAdapter{
  readonly name:string;
  private readonly baseUrl:string;
  private readonly fetcher:FetchLike;
  private readonly timeoutMs:number;
  constructor(options:OllamaProviderOptions){
    this.name=options.name??"ollama";this.baseUrl=options.baseUrl.replace(/\/$/,"");this.fetcher=options.fetcher??fetch;this.timeoutMs=options.timeoutMs??60000;
  }
  async health(){
    const started=Date.now();
    try{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try{
        const response=await this.fetcher(this.baseUrl+"/api/tags",{signal:controller.signal});
        return{provider:this.name,available:response.ok,latencyMs:Date.now()-started,reason:response.ok?undefined:"Ollama endpoint unavailable",updatedAt:new Date().toISOString()};
      }finally{clearTimeout(timer);}
    }catch(error){
      return{provider:this.name,available:false,latencyMs:Date.now()-started,reason:error instanceof Error?error.message:"Ollama health check failed",updatedAt:new Date().toISOString()};
    }
  }
  async generate(model:ModelDefinition,request:ModelRequest):Promise<ModelResponse>{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const response=await this.fetcher(this.baseUrl+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:model.id,messages:[{role:"user",content:request.input}],stream:false}),signal:controller.signal});
      const raw=await response.text();
      if(!response.ok)throw new Error(this.name+" request failed ("+response.status+").");
      let data:{message?:{content?:unknown}};try{data=JSON.parse(raw);}catch{throw new Error(this.name+" returned invalid JSON.");}
      const output=data.message?.content;
      if(typeof output!=="string")throw new Error(this.name+" returned no text content.");
      return{modelId:model.id,provider:this.name,output};
    }finally{clearTimeout(timer);}
  }
}
