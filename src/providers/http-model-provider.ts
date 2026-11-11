import type {ModelProviderAdapter,ModelRequest,ModelResponse} from "../models/inference.js";
import type {ModelDefinition} from "../models/registry.js";

export interface HttpModelProviderOptions{
 name:string;
 baseUrl:string;
 healthUrl?:string;
 apiKey?:string;
 timeoutMs?:number;
 fetcher?:typeof fetch;
 headers?:Record<string,string>;
 buildUrl?:(model:ModelDefinition,request:ModelRequest)=>string;
 buildHealthUrl?:()=>string;
 buildBody:(model:ModelDefinition,request:ModelRequest)=>unknown;
 parseResponse:(body:unknown,model:ModelDefinition)=>ModelResponse;
}

export class HttpModelProvider implements ModelProviderAdapter{
 readonly name:string;
 private readonly fetcher:typeof fetch;
 constructor(private readonly options:HttpModelProviderOptions){
  this.name=options.name;
  this.fetcher=options.fetcher??fetch;
 }
 async health(){
  const started=Date.now();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1,this.options.timeoutMs??5000));
  try{
   const response=await this.fetcher(this.options.buildHealthUrl?.()??this.options.healthUrl??this.options.baseUrl,{method:"GET",redirect:"error",signal:controller.signal,headers:this.headers()});
   return{provider:this.name,available:response.ok,latencyMs:Date.now()-started,reason:response.ok?undefined:"HTTP "+response.status,updatedAt:new Date().toISOString()};
  }catch(error){
   return{provider:this.name,available:false,latencyMs:Date.now()-started,reason:error instanceof Error?error.message:"Provider health check failed",updatedAt:new Date().toISOString()};
  }finally{clearTimeout(timer);}
 }
 async generate(model:ModelDefinition,request:ModelRequest):Promise<ModelResponse>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1,request.timeoutMs??this.options.timeoutMs??30000));
  try{
   const response=await this.fetcher(this.options.buildUrl?.(model,request)??this.options.baseUrl,{method:"POST",redirect:"error",signal:controller.signal,headers:{"content-type":"application/json",...this.headers()},body:JSON.stringify(this.options.buildBody(model,request))});
   if(!response.ok){
    // Include the provider's own error text (never contains our key) so "model not found" or "quota" is visible.
    let detail="";try{detail=(await response.text()).replace(/\s+/g," ").slice(0,300);}catch{}
    // A provider or model that does not accept the answer's JSON shape is asked once more without it.
    if(response.status===400&&request.responseSchema){clearTimeout(timer);const{responseSchema:_dropped,...plain}=request;return this.generate(model,plain);}
    throw new Error(this.name+" returned HTTP "+response.status+"."+(detail?" "+detail:""));
   }
   const body=await response.json() as unknown;
   const parsed=this.options.parseResponse(body,model);
   // An error delivered as a normal reply (a quota or rate-limit body) must fail over to the next model, never reach the owner as an answer.
   const failure=providerError(body)??providerError(parsed.output);
   if(failure)throw new Error(this.name+" returned an error: "+failure);
   return parsed;
  }finally{clearTimeout(timer);}
 }
 private headers():Record<string,string>{
  return{...(this.options.apiKey?{"authorization":"Bearer "+this.options.apiKey}:{}),...(this.options.headers??{})};
 }
}

/** The provider's error text when a reply is really an error object ({"error":{...}}, or a list holding one), else null. */
export function providerError(value:unknown):string|null{
 let v=value;
 if(typeof v==="string"){const t=v.trim();if(!/^[\[{]\s*\{?\s*"error"/.test(t))return null;try{v=JSON.parse(t);}catch{return null;}}
 if(Array.isArray(v))v=v.find(item=>item&&typeof item==="object"&&"error" in item);
 if(!v||typeof v!=="object"||!("error" in v))return null;
 const e=(v as {error:unknown}).error;
 if(!e)return null;
 if(typeof e==="string")return e.slice(0,300);
 if(typeof e==="object"){const o=e as Record<string,unknown>;return [o.code,o.status,o.message].filter(x=>x!==undefined&&x!==null&&x!=="").join(" ").slice(0,300)||"error";}
 return "error";
}
