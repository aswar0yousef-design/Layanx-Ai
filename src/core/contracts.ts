import type {PermissionLevel} from "./types.js";

export interface AgentContract {
  agentId:string;
  purpose:string;
  allowedTools:string[];
  forbiddenResources:string[];
  requiredPermission:PermissionLevel;
  maxToolCalls:number;
  maxRuntimeMs:number;
  successCriteria:string[];
  stopCondition:string;
}

export interface ExecutionContext {
  missionId:string;
  agentId:string;
  traceId:string;
  startedAt:string;
}

export interface VerificationResult {
  verified:boolean;
  checks:string[];
  failures:string[];
}
