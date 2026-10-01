export type PermissionLevel="L1_READ"|"L2_ANALYZE"|"L3_MODIFY"|"L4_EXECUTE"|"L5_CRITICAL";
export type MissionStatus="planned"|"running"|"blocked"|"verifying"|"completed"|"failed"|"cancelled";
export interface MissionStep{id:string;description:string;status:"pending"|"running"|"completed"|"failed";}
export interface Mission{id:string;goal:string;status:MissionStatus;risk:"low"|"medium"|"high"|"critical";requiredPermission:PermissionLevel;steps:MissionStep[];createdAt:string;}
export interface ToolRequest{missionId:string;agentId:string;tool:string;action:string;permission:PermissionLevel;idempotencyKey:string;payload:unknown;}
