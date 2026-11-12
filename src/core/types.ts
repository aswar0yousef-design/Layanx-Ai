import type {ImpactAnalysisResult} from "./impact-analysis.js";

export type PermissionLevel="L1_READ"|"L2_ANALYZE"|"L3_MODIFY"|"L4_EXECUTE"|"L5_CRITICAL";
export type MissionStatus="planned"|"running"|"blocked"|"verifying"|"completed"|"failed"|"cancelled";
export interface MissionStep{id:string;description:string;status:"pending"|"running"|"completed"|"failed";}
export interface MissionToolPlan{tool:string;action:string;permission:PermissionLevel;reason:string;payload?:Record<string,unknown>;
 /** The mission is done once this step succeeds (a one-step plan made without the model). */
 final?:boolean;
 /** This step already succeeded: a resume after an approval starts after it (and its small result is kept for the reply). */
 done?:boolean;doneData?:unknown;}
export interface Mission{id:string;goal:string;status:MissionStatus;risk:"low"|"medium"|"high"|"critical";requiredPermission:PermissionLevel;steps:MissionStep[];tools?:MissionToolPlan[];successCriteria?:string[];createdAt:string;projectId?:string;impactAnalysis?:ImpactAnalysisResult;selectedTests?:string[];dependencies?:string[];
 /** Written before a tool starts and cleared when it returns. Still set after a restart: that tool's outcome is unknown. */
 inFlight?:{tool:string;action:string;planIndex?:number;startedAt:string;runId:string};}
export interface ToolRequest{missionId:string;agentId:string;projectId?:string;tool:string;action:string;permission:PermissionLevel;idempotencyKey:string;payload:unknown;planIndex?:number;}
