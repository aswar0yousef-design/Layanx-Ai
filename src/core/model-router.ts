import {ModelRegistry,ModelSelectionRequest,ModelDefinition} from "../models/registry.js";
export class ModelRouter{
 constructor(private readonly registry:ModelRegistry){}
 select(capability:ModelSelectionRequest["capability"],options:Omit<ModelSelectionRequest,"capability">={}):ModelDefinition{return this.registry.select({capability,...options})[0];}
 selectAll(capability:ModelSelectionRequest["capability"],options:Omit<ModelSelectionRequest,"capability">={}){return this.registry.select({capability,...options});}
}