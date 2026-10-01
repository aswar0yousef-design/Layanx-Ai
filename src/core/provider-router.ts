import {ModelRouter} from "./model-router.js";
import type {ModelCapability} from "../models/registry.js";
import type {ModelClient,ModelRequest,ModelResponse} from "./provider-client.js";
export class ProviderRouter{
 constructor(private readonly router:ModelRouter,private readonly clients:Map<string,ModelClient>){}
 async generate(capability:ModelCapability,input:string,options?:{maxTokens?:number;temperature?:number}):Promise<ModelResponse>{
  const model=this.router.select(capability);
  const client=this.clients.get(model.provider);
  if(!client)throw new Error("No client registered for provider: "+model.provider);
  return client.generate({model:model.id,capability,input,...options});
 }
}
