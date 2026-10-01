import {ModelRouter} from "./model-router.js";
import {ProviderHealthMonitor} from "./provider-health.js";
import type {ModelCapability} from "../models/registry.js";
import type {ModelClient,ModelResponse} from "./provider-client.js";
export class ProviderRouter{
 constructor(private readonly router:ModelRouter,private readonly clients:Map<string,ModelClient>,private readonly health?:ProviderHealthMonitor){}
 async generate(capability:ModelCapability,input:string,options?:{maxTokens?:number;temperature?:number}):Promise<ModelResponse>{
  const candidates=this.router.selectAll(capability);
  if(!candidates.length)throw new Error("No enabled model matches capability.");
  const healthy=this.health?new Set((await this.health.healthy()).map(p=>p.name)):undefined;
  const failures:string[]=[];
  for(const model of candidates){
   if(healthy&&!healthy.has(model.provider))continue;
   const client=this.clients.get(model.provider);
   if(!client){failures.push(model.provider+": no client");continue;}
   try{return await client.generate({model:model.id,capability,input,...options});}
   catch(error){failures.push(model.provider+": "+(error instanceof Error?error.message:"request failed"));}
  }
  if(healthy&&healthy.size===0)throw new Error("No healthy provider is available.");
  throw new Error("All eligible providers failed: "+failures.join(" | "));
 }
}
