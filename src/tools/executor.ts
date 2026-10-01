import type {ToolRequest} from "../core/types.js";
import type {ToolDefinition} from "./registry.js";
import {ToolRegistry} from "./registry.js";
import {Sentinel} from "../security/sentinel.js";

export interface ToolAdapter { execute(request:ToolRequest):Promise<unknown>; }

export class ToolExecutor {
 constructor(private readonly registry:ToolRegistry, private readonly sentinel:Sentinel){}
 async execute(request:ToolRequest,adapter:ToolAdapter){
  const tool=this.registry.get(request.tool);
  if(tool.dangerous && request.permission!=="L4_EXECUTE" && request.permission!=="L5_CRITICAL")
   return {ok:false,verified:false,error:"Dangerous tool requires execution permission."};
  const gate=this.sentinel.inspect(request.action);
  if(!gate.allowed)return {ok:false,verified:false,error:gate.reason};
  try{return {ok:true,verified:false,data:await adapter.execute(request)};}
  catch(error){return {ok:false,verified:false,error:error instanceof Error?error.message:String(error)};}
 }
}
