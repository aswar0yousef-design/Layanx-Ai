import type {ModelRegistry} from "../models/registry.js";
import {ModelRouter} from "./model-router.js";
import type {ModelExecutionAttempt,ModelExecutionResult,ModelProviderAdapter,ModelRequest,ModelRoutingOptions} from "../models/inference.js";
export class ModelProviderRegistry{
 private readonly providers=new Map<string,ModelProviderAdapter>();
 register(provider:ModelProviderAdapter){if(this.providers.has(provider.name))throw new Error("Provider already registered: "+provider.name);this.providers.set(provider.name,provider);}
 get(name:string){const p=this.providers.get(name);if(!p)throw new Error("Unknown model provider: "+name);return p;}
 list(){return[...this.providers.values()];}
}
export class ModelExecutionRouter{
 private readonly router:ModelRouter;
 constructor(private readonly models:ModelRegistry,private readonly providers:ModelProviderRegistry,private readonly defaultRouting:ModelRoutingOptions={}){this.router=new ModelRouter(models);}
 async execute(request:ModelRequest):Promise<ModelExecutionResult>{
  const routing={...this.defaultRouting,...(request.routing??{})};
  const candidates=this.router.selectAll(request.capability,routing);
  const attempts:ModelExecutionAttempt[]=[];
  for(const model of candidates){
   let provider:ModelProviderAdapter;
   try{provider=this.providers.get(model.provider);}catch(error){attempts.push({modelId:model.id,provider:model.provider,ok:false,error:error instanceof Error?error.message:"Provider unavailable"});continue;}
   const health=await provider.health();
   if(health.provider!==provider.name){attempts.push({modelId:model.id,provider:model.provider,ok:false,error:"Provider health identity mismatch."});continue;}
   if(!health.available){attempts.push({modelId:model.id,provider:model.provider,ok:false,error:health.reason??"Provider unavailable"});continue;}
   try{
    const response=await provider.generate(model,request);
    if(response.modelId!==model.id||response.provider!==provider.name){attempts.push({modelId:model.id,provider:model.provider,ok:false,error:"Provider response identity mismatch."});continue;}
    return{...response,attempts:[...attempts,{modelId:model.id,provider:model.provider,ok:true}]};
   }catch(error){attempts.push({modelId:model.id,provider:model.provider,ok:false,error:error instanceof Error?error.message:"Model execution failed"});}
  }
  throw new Error("All candidate model providers failed: "+attempts.map(a=>a.provider+":"+a.error).join(" | "));
 }
}