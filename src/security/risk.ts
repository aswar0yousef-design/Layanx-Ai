import type {PermissionLevel,ToolRequest} from "../core/types.js";
const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
export interface RiskResult{level:"low"|"medium"|"high"|"critical";reasons:string[];requiresApproval:boolean;}
export class RiskEngine{
 assess(request:ToolRequest):RiskResult{
  const reasons:string[]=[];
  if(rank[request.permission]>=4)reasons.push("Execution-level permission.");
  if(/delete|drop|payment|transfer|secret|credential/i.test(request.action))reasons.push("Sensitive action keyword.");
  const level=reasons.length>=2?"critical":reasons.length===1?"high":"low";
  return{level,reasons,requiresApproval:level==="high"||level==="critical"};
 }
}
