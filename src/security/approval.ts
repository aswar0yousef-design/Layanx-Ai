import type {PermissionLevel} from "../core/types.js";
export interface ApprovalRequest{id:string;missionId:string;agentId:string;action:string;permission:PermissionLevel;reason:string;expiresAt:string;}
export class ApprovalEngine{
 private readonly approved=new Set<string>();
 approve(id:string){this.approved.add(id);}
 revoke(id:string){this.approved.delete(id);}
 isApproved(id:string){return this.approved.has(id);}
}
