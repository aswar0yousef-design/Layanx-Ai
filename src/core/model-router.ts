import {ModelRegistry,ModelCapability} from "../models/registry.js";
export class ModelRouter{
 constructor(private readonly registry:ModelRegistry){}
 select(capability:ModelCapability){const models=this.registry.find(capability);if(!models.length)throw new Error("No enabled model matches capability.");return models[0];}
}
