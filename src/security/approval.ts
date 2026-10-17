import {createHash} from "node:crypto";
import type {PermissionLevel} from "../core/types.js";

export interface ApprovalRequest{
 id:string;missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;
 payloadHash:string;reason:string;expiresAt:string;
}
export interface ApprovalSnapshot{requests:ApprovalRequest[];approvedIds:string[];rejectedIds?:string[];}

/**
 * What the owner actually saw. A phone sends this back with its decision, so a decision
 * can only ever apply to that exact request (same mission, agent, tool, action, permission,
 * payload, reason and expiry), never to a request that changed or replaced it.
 */
export function approvalDigest(r:ApprovalRequest):string{
 return createHash("sha256").update(JSON.stringify([r.id,r.missionId,r.agentId,r.tool,r.action,r.permission,r.payloadHash,r.reason,r.expiresAt])).digest("base64url");
}

export class ApprovalEngine{
 private readonly requests=new Map<string,ApprovalRequest>();
 private readonly approved=new Set<string>();
 /** Requests the owner said no to: no longer waiting for a decision. Approving later still works. */
 private readonly rejected=new Set<string>();

 create(input:Omit<ApprovalRequest,"id">){
  const request={...input,id:crypto.randomUUID()};
  this.requests.set(request.id,request);
  return structuredClone(request);
 }

 findPending(context:{missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;payloadHash:string}){
  const now=Date.now();
  return [...this.requests.values()].find(request=>
   request.missionId===context.missionId&&request.agentId===context.agentId&&
   request.tool===context.tool&&request.action===context.action&&
   request.permission===context.permission&&request.payloadHash===context.payloadHash&&
   Date.parse(request.expiresAt)>now&&!this.approved.has(request.id)&&!this.rejected.has(request.id)
  );
 }

 ensure(input:Omit<ApprovalRequest,"id">){
  const pending=this.findPending(input);
  return pending?structuredClone(pending):this.create(input);
 }

 approve(id:string){
  const request=this.get(id);
  if(Date.parse(request.expiresAt)<=Date.now())throw new Error("Approval request expired.");
  this.approved.add(id);
  this.rejected.delete(id);
 }

 /** Withdraw an approval, or reject a request that is still waiting. */
 revoke(id:string){this.get(id);this.approved.delete(id);this.rejected.add(id);}
 isRejected(id:string){return this.rejected.has(id);}
 get(id:string){const request=this.requests.get(id);if(!request)throw new Error("Unknown approval request.");return structuredClone(request);}
 isApproved(id:string){const request=this.get(id);return this.approved.has(id)&&Date.parse(request.expiresAt)>Date.now();}

 validate(id:string,context:{missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;payloadHash:string}){
  const request=this.get(id);
  if(!this.isApproved(id))return{allowed:false,reason:"Approval missing, revoked, or expired."};
  if(request.missionId!==context.missionId||request.agentId!==context.agentId||request.tool!==context.tool||
     request.action!==context.action||request.permission!==context.permission||request.payloadHash!==context.payloadHash)
   return{allowed:false,reason:"Approval scope mismatch."};
  return{allowed:true,reason:"Approval valid."};
 }

 authorize(id:string,context:{missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;payloadHash:string}){return this.validate(id,context);}

 revokeMission(missionId:string){
  for(const [id,r] of this.requests)if(r.missionId===missionId)this.approved.delete(id);
 }
 /** A deleted mission: its requests leave the approvals list (none of them can be approved any more). */
 forgetMission(missionId:string){
  for(const [id,r] of this.requests)if(r.missionId===missionId){this.requests.delete(id);this.approved.delete(id);this.rejected.delete(id);}
 }

 list():ApprovalRequest[]{return[...this.requests.values()].map(request=>structuredClone(request));}

 snapshot():ApprovalSnapshot{
  return{requests:this.list(),approvedIds:[...this.approved],rejectedIds:[...this.rejected]};
 }

 restore(snapshot:ApprovalSnapshot):void{
  for(const request of snapshot.requests)this.requests.set(request.id,structuredClone(request));
  for(const id of snapshot.approvedIds){
   if(this.requests.has(id))this.approved.add(id);
  }
  for(const id of snapshot.rejectedIds??[]){
   if(this.requests.has(id)&&!this.approved.has(id))this.rejected.add(id);
  }
 }
}
