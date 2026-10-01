import type {ModelCapability,ModelDefinition} from "../models/registry.js";
import {ModelRegistry} from "../models/registry.js";
import type {ModelClient,ModelResponse} from "./provider-client.js";
import {CooldownManager} from "./cooldown.js";
import {CostRouter} from "./cost-router.js";
export class FailoverRouter{
 constructor(private readonly models:ModelRegistry,private readonly clients:Map<string,ModelClient>,private readonly cooldown=new CooldownManager(),private readonly costs=new CostRouter(new Map())){}
 async generate(capability:ModelCapability,input:string):Promise<ModelResponse>{
  const candidates=this.models.find(capability).filter(m=>this.cooldown.available(m.provider));
  if(!candidates.length)throw new Error("No healthy provider is currently available.");
  let last:unknown;
  for(const model of candidates){
   const client=this.clients.get(model.provider);if(!client)continue;
   try{const result=await client.generate({model:model.id,capability,input});this.cooldown.recordSuccess(model.provider);return result;}
   catch(error){last=error;this.cooldown.recordFailure(model.provider,error instanceof Error?error.message:String(error));}
  }
  throw new Error("All provider attempts failed: "+String(last));
 }
}
