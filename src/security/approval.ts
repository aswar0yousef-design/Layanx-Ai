import type {PermissionLevel} from "../core/types.js";
export interface ApprovalRequest{id:string;missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;payloadHash:string;reason:string;expiresAt:string;}
export class ApprovalEngine{
 private readonly requests=new Map<string,ApprovalRequest>();
 private readonly approved=new Set<string>();
 create(input:Omit<ApprovalRequest,"id">){const request={...input,id:crypto.randomUUID()};this.requests.set(request.id,request);return request;}
 approve(id:string){const request=this.get(id);if(Date.parse(request.expiresAt)<=Date.now())throw new Error("Approval request expired.");this.approved.add(id);}
 revoke(id:string){this.approved.delete(id);}
 get(id:string){const request=this.requests.get(id);if(!request)throw new Error("Unknown approval request.");return request;}
 isApproved(id:string){const request=this.get(id);return this.approved.has(id)&&Date.parse(request.expiresAt)>Date.now();}
 validate(id:string,context:{missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;payloadHash:string}){
  const request=this.get(id);
  if(!this.isApproved(id))return{allowed:false,reason:"Approval missing, revoked, or expired."};
  if(request.missionId!==context.missionId||request.agentId!==context.agentId||request.tool!==context.tool||request.action!==context.action||request.permission!==context.permission||request.payloadHash!==context.payloadHash)return{allowed:false,reason:"Approval scope mismatch."};
  return{allowed:true,reason:"Approval valid."};
 }
 authorize(id:string,context:{missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;payloadHash:string}){return this.validate(id,context);}
 revokeMission(missionId:string){for(const [id,r] of this.requests)if(r.missionId===missionId)this.approved.delete(id);}
}
