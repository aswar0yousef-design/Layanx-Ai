import type {ToolRequest} from "../core/types.js";
import {ToolRegistry} from "./registry.js";
import {Sentinel} from "../security/sentinel.js";
import {IdempotencyStore} from "../core/idempotency.js";

export interface ToolAdapter { execute(request:ToolRequest):Promise<unknown>; }

export class ToolExecutor {
 constructor(private readonly registry:ToolRegistry, private readonly sentinel:Sentinel, private readonly idempotency=new IdempotencyStore()){}
 async execute(request:ToolRequest,adapter:ToolAdapter){
  const tool=this.registry.get(request.tool);
  if(tool.dangerous && request.permission!=="L4_EXECUTE" && request.permission!=="L5_CRITICAL")
   return {ok:false,verified:false,error:"Dangerous tool requires execution permission."};
  const gate=this.sentinel.inspect(request.action);
  if(!gate.allowed)return {ok:false,verified:false,error:gate.reason};

  const claim=this.idempotency.begin(request);
  if(!claim.ok){
   if(claim.record.status==="completed")return{ok:true,verified:true,data:claim.record.data,replayed:true};
   if(claim.record.status==="running")return{ok:false,verified:false,error:"Duplicate operation is already in progress."};
   return{ok:false,verified:false,error:claim.record.error??"A previous operation with this idempotency key failed."};
  }

  try{
   const data=await adapter.execute(request);
   this.idempotency.complete(request.idempotencyKey,data);
   return {ok:true,verified:false,data};
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   this.idempotency.fail(request.idempotencyKey,message);
   return {ok:false,verified:false,error:message};
  }
 }
}
