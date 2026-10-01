import type {ModelDefinition,ModelCapability} from "../models/registry.js";
import {ModelRegistry} from "../models/registry.js";
export class ProviderFailover{
 constructor(private readonly models:ModelRegistry){}
 select(capability:ModelCapability,excluded:string[]=[]):ModelDefinition{
  const candidate=this.models.find(capability).find(m=>!excluded.includes(m.id));
  if(!candidate)throw new Error("No healthy fallback model is available.");
  return candidate;
 }
}
