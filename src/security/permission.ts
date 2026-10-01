import type {PermissionLevel,ToolRequest} from "../core/types.js";
import type {AgentContract} from "../core/contracts.js";
import {PolicyEngine} from "./policy.js";

export class PermissionEngine {
  constructor(private readonly policy=new PolicyEngine()){}

  authorize(request:ToolRequest,contract:AgentContract,granted:PermissionLevel){
    if(!contract.allowedTools.includes(request.tool))
      return {allowed:false,reason:"Tool is outside the agent contract."};
    if(contract.forbiddenResources.includes(request.tool))
      return {allowed:false,reason:"Tool is explicitly forbidden by the contract."};
    return this.policy.evaluate(request,granted);
  }
}
