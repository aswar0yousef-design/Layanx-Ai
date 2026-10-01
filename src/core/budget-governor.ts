import type {Budget,Usage} from "./budget.js";
export type GovernorDecision={allowed:boolean;reason:string;remaining:Budget};
export class BudgetGovernor{
 constructor(private readonly budget:Budget){}
 evaluate(usage:Usage):GovernorDecision{
  const remaining={maxToolCalls:Math.max(0,this.budget.maxToolCalls-usage.toolCalls),maxRuntimeMs:Math.max(0,this.budget.maxRuntimeMs-usage.runtimeMs),maxCostUsd:Math.max(0,this.budget.maxCostUsd-usage.costUsd)};
  if(usage.toolCalls>=this.budget.maxToolCalls)return{allowed:false,reason:"Tool-call budget exhausted.",remaining};
  if(usage.runtimeMs>=this.budget.maxRuntimeMs)return{allowed:false,reason:"Runtime budget exhausted.",remaining};
  if(usage.costUsd>=this.budget.maxCostUsd)return{allowed:false,reason:"Cost budget exhausted.",remaining};
  return{allowed:true,reason:"Budget available.",remaining};
 }
}
