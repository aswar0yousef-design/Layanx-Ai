import type {ModelDefinition,ModelCapability,ModelRegistry} from "../models/registry.js";
import type {ModelExecutionAttempt,ModelExecutionResult,ModelProviderAdapter,ModelRequest} from "../models/inference.js";

export class ModelProviderRegistry{
  private readonly providers=new Map<string,ModelProviderAdapter>();
  register(provider:ModelProviderAdapter){
    if(this.providers.has(provider.name))throw new Error("Provider already registered: "+provider.name);
    this.providers.set(provider.name,provider);
  }
  get(name:string){const p=this.providers.get(name);if(!p)throw new Error("Unknown model provider: "+name);return p;}
  list(){return[...this.providers.values()];}
}

export class ModelExecutionRouter{
  constructor(private readonly models:ModelRegistry,private readonly providers:ModelProviderRegistry){}

  async execute(request:ModelRequest):Promise<ModelExecutionResult>{
    const candidates=this.models.find(request.capability);
    if(!candidates.length)throw new Error("No enabled model matches capability: "+request.capability);
    const attempts:ModelExecutionAttempt[]=[];
    for(const model of candidates){
      const provider=this.providers.get(model.provider);
      const health=await provider.health();
      if(!health.available){
        attempts.push({modelId:model.id,provider:model.provider,ok:false,error:health.reason??"Provider unavailable"});
        continue;
      }
      try{
        const response=await provider.generate(model,request);
        return{...response,attempts:[...attempts,{modelId:model.id,provider:model.provider,ok:true}]};
      }catch(error){
        attempts.push({modelId:model.id,provider:model.provider,ok:false,error:error instanceof Error?error.message:"Model execution failed"});
      }
    }
    throw new Error("All candidate model providers failed: "+attempts.map(a=>a.provider+":"+a.error).join(" | "));
  }
}
