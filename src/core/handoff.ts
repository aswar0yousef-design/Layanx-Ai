import type {AgentContract} from "./contracts.js";
import type {Mission} from "./types.js";
import {DelegationManager} from "./delegation.js";

export interface MissionHandoff{
 id:string;
 missionId:string;
 fromAgentId:string;
 toAgentId:string;
 goal:string;
 context:unknown;
 requiredPermission:Mission["requiredPermission"];
 createdAt:string;
 status:"pending"|"accepted"|"completed"|"rejected";
}

export interface HandoffExecution{action:string;payload:unknown;tool?:string;}\n\nexport interface HandoffRequest{
 missionId:string;
 fromAgentId:string;
 toAgent:AgentContract;
 goal:string;
 context:unknown;
 requiredPermission:Mission["requiredPermission"];
}

export class MissionHandoffManager{
 private readonly handoffs=new Map<string,MissionHandoff>();

 constructor(private readonly delegation:DelegationManager){}

 create(request:HandoffRequest):MissionHandoff{
  if(request.toAgent.requiredPermission==="L5_CRITICAL" && request.requiredPermission!=="L5_CRITICAL")
   throw new Error("Handoff permission cannot exceed the mission permission.");
  if(!request.toAgent.allowedTools.length)throw new Error("Handoff target agent has no allowed tools.");
  const handoff:MissionHandoff={
   id:crypto.randomUUID(),missionId:request.missionId,fromAgentId:request.fromAgentId,
   toAgentId:request.toAgent.agentId,goal:request.goal,context:structuredClone(request.context),execution:request.execution?structuredClone(request.execution):undefined,
   requiredPermission:request.requiredPermission,createdAt:new Date().toISOString(),status:"pending"
  };
  this.handoffs.set(handoff.id,handoff);
  return structuredClone(handoff);
 }

 accept(id:string):MissionHandoff{
  const handoff=this.get(id);
  if(handoff.status!=="pending")throw new Error("Handoff is not pending.");
  const next={...handoff,status:"accepted" as const};this.handoffs.set(id,next);return structuredClone(next);
 }

 complete(id:string):MissionHandoff{
  const handoff=this.get(id);
  if(handoff.status!=="accepted")throw new Error("Handoff must be accepted before completion.");
  const next={...handoff,status:"completed" as const};this.handoffs.set(id,next);return structuredClone(next);
 }

 reject(id:string):MissionHandoff{
  const handoff=this.get(id);
  if(handoff.status==="completed")throw new Error("Completed handoff cannot be rejected.");
  const next={...handoff,status:"rejected" as const};this.handoffs.set(id,next);return structuredClone(next);
 }

 get(id:string){const h=this.handoffs.get(id);if(!h)throw new Error("Unknown mission handoff: "+id);return structuredClone(h);}
 forMission(missionId:string){return[...this.handoffs.values()].filter(h=>h.missionId===missionId).map(h=>structuredClone(h));}
 restore(handoffs:MissionHandoff[]){for(const handoff of handoffs)this.handoffs.set(handoff.id,structuredClone(handoff));}
}
