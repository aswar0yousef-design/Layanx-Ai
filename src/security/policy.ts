import type {PermissionLevel,ToolRequest} from "../core/types.js";
const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
export class PolicyEngine{
 evaluate(request:ToolRequest,granted:PermissionLevel){
  if(rank[request.permission]>rank[granted])return{allowed:false,reason:"Requested permission exceeds granted scope."};
  if(!request.idempotencyKey)return{allowed:false,reason:"Missing idempotency key."};
  return{allowed:true,reason:"Permission accepted."};
 }
}