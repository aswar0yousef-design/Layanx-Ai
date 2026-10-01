import {createRecoveryReport} from "../src/release/recovery-report.js";
import type {PersistedRecoveryRecord} from "../src/release/recovery-persistence.js";

const record:PersistedRecoveryRecord={
 version:1,
 recoveryId:"report-test",
 deploymentVersion:"1.1.0",
 deploymentCommitSha:"bad1234",
 deploymentChecksum:"b".repeat(64),
 state:"verified",
 attempts:1,
 startedAt:"2026-01-02T00:00:00Z",
 updatedAt:"2026-01-02T00:01:00Z",
 targetVersion:"1.0.0",
 targetCommitSha:"good1234",
 targetChecksum:"c".repeat(64),
 reason:"post-recovery health passed"
};
const deployment={
 version:"1.1.0",
 commitSha:"bad1234",
 manifestChecksum:"b".repeat(64),
 deployedAt:"2026-01-02T00:00:00Z"
};
const audit={
 resource:"deployment:1.1.0",
 complete:true
};
const decision={action:"keep" as const,target:deployment,requiresVerification:false};
const report=createRecoveryReport(deployment,record,decision,audit);
if(report.recoveryId!=="report-test")throw new Error("Recovery id missing.");
if(report.status!=="recovered"||!report.terminal||report.recoverable)throw new Error("Recovery report status is incorrect.");
if(report.state!=="verified")throw new Error("Recovery state missing.");
if(report.target?.version!=="1.0.0")throw new Error("Recovery target missing.");
if(report.attempts!==1||!report.audit.complete)throw new Error("Recovery evidence missing.");
if(!report.evidence.rollbackPerformed||!report.evidence.verificationCompleted||report.durationMs!==60000)throw new Error("Recovery report evidence summary is incorrect.");
console.log("Recovery report test passed.");
