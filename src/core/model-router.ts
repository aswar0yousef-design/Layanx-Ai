import {ModelRegistry,ModelSelectionRequest,ModelDefinition} from "../models/registry.js";
export class ModelRouter{
 constructor(private readonly registry:ModelRegistry){}
 select(capability:ModelSelectionRequest["capability"],options:Omit<ModelSelectionRequest,"capability">={}):ModelDefinition{const selected=this.registry.select({capability,...options})[0];if(!selected)throw new Error("No model is available for capability: "+capability);return selected;}
 selectAll(capability:ModelSelectionRequest["capability"],options:Omit<ModelSelectionRequest,"capability">={}){return this.registry.select({capability,...options});}
}