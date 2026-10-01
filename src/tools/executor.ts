import type {ToolRequest} from "../core/types.js";
import {ToolRegistry} from "./registry.js";
import {Sentinel} from "../security/sentinel.js";
import {IdempotencyStore,type IdempotencyService} from "../core/idempotency.js";

export interface ToolAdapter { execute(request:ToolRequest):Promise<unknown>; }

export class ToolExecutor {
 constructor(private readonly registry:ToolRegistry, private readonly sentinel:Sentinel, private readonly idempotency:IdempotencyService=new IdempotencyStore()){}
 async execute(request:ToolRequest,adapter:ToolAdapter){
  const tool=this.registry.get(request.tool);
  if(tool.dangerous && request.permission!=="L4_EXECUTE" && request.permission!=="L5_CRITICAL")
   return {ok:false,verified:false,error:"Dangerous tool requires execution permission."};
  const gate=this.sentinel.inspect(request.action);
  if(!gate.allowed)return {ok:false,verified:false,error:gate.reason};

  const claim=await this.idempotency.begin(request);
  if(!claim.accepted){
   if(claim.replay)return{ok:true,verified:true,data:claim.record.data,replayed:true};
   return{ok:false,verified:false,error:claim.reason??"Duplicate operation rejected."};
  }

  try{
   const data=await adapter.execute(request);
   await this.idempotency.complete(request.idempotencyKey,data);
   return {ok:true,verified:false,data};
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   await this.idempotency.fail(request.idempotencyKey,message);
   return {ok:false,verified:false,error:message};
  }
 }
}
