import type {ModelDefinition} from "../models/registry.js";
export interface ModelCost{inputPer1k:number;outputPer1k:number;}
export class CostRouter{
 constructor(private readonly costs:Map<string,ModelCost>){}
 estimate(model:ModelDefinition,inputTokens:number,outputTokens:number){
  const c=this.costs.get(model.id);if(!c)return Number.POSITIVE_INFINITY;
  return inputTokens/1000*c.inputPer1k+outputTokens/1000*c.outputPer1k;
 }
 order(models:ModelDefinition[],budgetUsd?:number){
  return [...models].filter(m=>budgetUsd===undefined||this.costs.has(m.id)).sort((a,b)=>this.estimate(a,1000,1000)-this.estimate(b,1000,1000));
 }
}
