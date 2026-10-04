import type {Deployment, RecoveryDecision} from "./rollback.js";
import type {RecoveryAuditSummary} from "./recovery-audit.js";
import type {PersistedRecoveryRecord} from "./recovery-persistence.js";
import type {RecoveryResumePlan} from "./recovery-resume.js";

export type RecoveryReportStatus="active"|"recovered"|"halted";

export interface RecoveryReport{
 recoveryId:string;
 status:RecoveryReportStatus;
 state:PersistedRecoveryRecord["state"];
 terminal:boolean;
 recoverable:boolean;
 deployment:Deployment;
 target?:Deployment;
 attempts:number;
 startedAt?:string;
 updatedAt?:string;
 durationMs?:number;
 reason?:string;
 decision:RecoveryDecision;
 audit:RecoveryAuditSummary;
 resume?:RecoveryResumePlan;
 evidence:{
  rollbackPerformed:boolean;
  verificationCompleted:boolean;
  auditComplete:boolean;
 };
}

export function createRecoveryReport(
 deployment:Deployment,
 record:PersistedRecoveryRecord,
 decision:RecoveryDecision,
 audit:RecoveryAuditSummary,
 resume?:RecoveryResumePlan
):RecoveryReport{
 const target=record.targetVersion&&record.targetCommitSha&&record.targetChecksum
  ? {
     version:record.targetVersion,
     commitSha:record.targetCommitSha,
     manifestChecksum:record.targetChecksum,
     deployedAt:record.updatedAt
    }
  : undefined;
 const status:RecoveryReportStatus=record.state==="verified"?"recovered":record.state==="halted"?"halted":"active";
 const started=Date.parse(record.startedAt);
 const updated=Date.parse(record.updatedAt);
 return{
  recoveryId:record.recoveryId,
  status,
  state:record.state,
  terminal:status!=="active",
  recoverable:status==="active"&&record.state!=="halted",
  deployment,
  target,
  attempts:record.attempts,
  startedAt:record.startedAt,
  updatedAt:record.updatedAt,
  durationMs:Number.isFinite(started)&&Number.isFinite(updated)?Math.max(0,updated-started):undefined,
  reason:record.reason,
  decision,
  audit,
  resume,
  evidence:{
   rollbackPerformed:Boolean(audit.rollback||target),
   verificationCompleted:Boolean(audit.verified||record.state==="verified"),
   auditComplete:audit.complete
  }
 };
}
