import type {PermissionLevel} from "./types.js";

export type AgentRole="orchestrator"|"developer"|"researcher"|"security"|"devops"|"analyst"|"general";

export interface AgentProfile {
  role:AgentRole;
  description:string;
  preferredCapabilities:string[];
  memoryTags:string[];
}

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
  profile?:AgentProfile;
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
