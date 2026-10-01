import type {Mission,ToolRequest} from "./types.js";
import {LayanXCore} from "./orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";

export interface RuntimeResult{ok:boolean;missionId:string;verified:boolean;error?:string;data?:unknown;}

export class ExecutionRuntime{
 constructor(private readonly core:LayanXCore){}
 async run(mission:Mission,request:ToolRequest,adapter:ToolAdapter):Promise<RuntimeResult>{
  const contract=this.core.agents.get(request.agentId);
  const permission=this.core.permissions.authorize(request,contract,request.permission);
  if(!permission.allowed){this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:"blocked",timestamp:new Date().toISOString(),detail:permission.reason});return{ok:false,missionId:mission.id,verified:false,error:permission.reason};}
  const sentinel=this.core.sentinel.inspect(request.action);
  if(!sentinel.allowed){this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:"blocked",timestamp:new Date().toISOString(),detail:sentinel.reason});return{ok:false,missionId:mission.id,verified:false,error:sentinel.reason};}
  this.core.recovery.checkpoint({missionId:mission.id,stepId:mission.steps[0]?.id??"mission",createdAt:new Date().toISOString(),state:{request}});
  const result=await this.core.executor.execute(request,adapter);
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:result.ok?"completed":"failed",timestamp:new Date().toISOString(),detail:result.error});
  if(!result.ok)return{ok:false,missionId:mission.id,verified:false,error:result.error};
  return{ok:true,missionId:mission.id,verified:true,data:result.data};
 }
}
