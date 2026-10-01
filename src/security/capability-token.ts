import type {PermissionLevel} from "../core/types.js";
export interface CapabilityToken{ id:string;missionId:string;agentId:string;projectId:string;resource:string;permission:PermissionLevel;issuedAt:string;expiresAt:string;nonce:string; }
const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
export class CapabilityTokenService{
 issue(input:Omit<CapabilityToken,"id"|"issuedAt"|"nonce">):CapabilityToken{return{...input,id:crypto.randomUUID(),issuedAt:new Date().toISOString(),nonce:crypto.randomUUID()};}
 validate(token:CapabilityToken,request:{missionId:string;agentId:string;projectId:string;resource:string;permission:PermissionLevel}){
  if(Date.parse(token.expiresAt)<=Date.now())return{allowed:false,reason:"Capability token expired."};
  if(token.missionId!==request.missionId||token.agentId!==request.agentId||token.projectId!==request.projectId||token.resource!==request.resource)return{allowed:false,reason:"Capability token scope mismatch."};
  if(rank[request.permission]>rank[token.permission])return{allowed:false,reason:"Requested permission exceeds token scope."};
  return{allowed:true,reason:"Capability token valid."};
 }
}
