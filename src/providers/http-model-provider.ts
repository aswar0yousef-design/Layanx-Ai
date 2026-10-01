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
 buildUrl?:(model:ModelDefinition,request:ModelRequest,operation:"health"|"generate")=>string;
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
   const response=await this.fetcher(this.options.buildUrl?.(undefined as unknown as ModelDefinition,undefined as unknown as ModelRequest,"health")??this.options.healthUrl??this.options.baseUrl,{method:"GET",redirect:"error",signal:controller.signal,headers:this.headers()});
   return{provider:this.name,available:response.ok,latencyMs:Date.now()-started,reason:response.ok?undefined:"HTTP "+response.status,updatedAt:new Date().toISOString()};
  }catch(error){
   return{provider:this.name,available:false,latencyMs:Date.now()-started,reason:error instanceof Error?error.message:"Provider health check failed",updatedAt:new Date().toISOString()};
  }finally{clearTimeout(timer);}
 }
 async generate(model:ModelDefinition,request:ModelRequest):Promise<ModelResponse>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1,this.options.timeoutMs??30000));
  try{
   const response=await this.fetcher(this.options.buildUrl?.(model,request,"generate")??this.options.baseUrl,{method:"POST",redirect:"error",signal:controller.signal,headers:{"content-type":"application/json",...this.headers()},body:JSON.stringify(this.options.buildBody(model,request))});
   if(!response.ok)throw new Error(this.name+" returned HTTP "+response.status+".");
   return this.options.parseResponse(await response.json(),model);
  }finally{clearTimeout(timer);}
 }
 private headers():Record<string,string>{
  return{...(this.options.apiKey?{"authorization":"Bearer "+this.options.apiKey}:{}),...(this.options.headers??{})};
 }
}
