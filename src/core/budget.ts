export interface Budget{maxToolCalls:number;maxRuntimeMs:number;maxCostUsd:number;}
export interface Usage{toolCalls:number;runtimeMs:number;costUsd:number;}
export class BudgetGuard{
 check(b:Budget,u:Usage){if(u.toolCalls>b.maxToolCalls)return{allowed:false,reason:"Tool-call budget exceeded."};if(u.runtimeMs>b.maxRuntimeMs)return{allowed:false,reason:"Runtime budget exceeded."};if(u.costUsd>b.maxCostUsd)return{allowed:false,reason:"Cost budget exceeded."};return{allowed:true,reason:"Budget within limits."};}
}
