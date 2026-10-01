import type {Deployment, RecoveryDecision} from "./rollback.js";
import type {RecoveryAuditSummary} from "./recovery-audit.js";
import type {PersistedRecoveryRecord} from "./recovery-persistence.js";
import type {RecoveryResumePlan} from "./recovery-resume.js";

export interface RecoveryReport{
 recoveryId:string;
 state:PersistedRecoveryRecord["state"];
 deployment:Deployment;
 target?:Deployment;
 attempts:number;
 startedAt?:string;
 updatedAt?:string;
 reason?:string;
 decision:RecoveryDecision;
 audit:RecoveryAuditSummary;
 resume?:RecoveryResumePlan;
}

export function createRecoveryReport(
 deployment:Deployment,
 record:PersistedRecoveryRecord,
 decision:RecoveryDecision,
 audit:RecoveryAuditSummary,
 resume?:RecoveryResumePlan
):RecoveryReport{
 return{
  recoveryId:record.recoveryId,
  state:record.state,
  deployment,
  target:record.targetVersion&&record.targetCommitSha&&record.targetChecksum
   ? {
      version:record.targetVersion,
      commitSha:record.targetCommitSha,
      manifestChecksum:record.targetChecksum,
      deployedAt:record.updatedAt
     }
   : undefined,
  attempts:record.attempts,
  startedAt:record.startedAt,
  updatedAt:record.updatedAt,
  reason:record.reason,
  decision,
  audit,
  resume
 };
}
