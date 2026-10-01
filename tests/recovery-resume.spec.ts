import {RecoveryResumeEngine} from "../src/release/recovery-resume.js";
import {RecoveryStateMachine} from "../src/release/recovery-state-machine.js";
import {RECOVERY_RECORD_VERSION} from "../src/release/recovery-persistence.js";

const engine=new RecoveryResumeEngine();
const base={
 version:RECOVERY_RECORD_VERSION,
 recoveryId:"r1",
 deploymentVersion:"1.1.0",
 deploymentCommitSha:"bad1234",
 deploymentChecksum:"b".repeat(64),
 attempts:1,
 startedAt:"2026-01-02T00:00:00Z",
 updatedAt:"2026-01-02T00:01:00Z",
 targetVersion:"1.0.0",
 targetCommitSha:"good1234",
 targetChecksum:"c".repeat(64)
};

const recovering=engine.plan({...base,state:"recovering"});
if(recovering.action!=="check"||!recovering.target||recovering.target.version!=="1.0.0")
 throw new Error("Recovering state did not require deployment verification.");

const rolledBack=engine.plan({...base,state:"rolled_back"});
if(rolledBack.action!=="verify"||rolledBack.target?.version!=="1.0.0")
 throw new Error("Rolled-back state did not resume at verification.");

const verifying=engine.plan({...base,state:"verifying"});
if(verifying.action!=="verify")throw new Error("Verifying state did not resume verification.");

const verified=engine.plan({...base,state:"verified"});
if(verified.action!=="complete")throw new Error("Verified state was not treated as complete.");

const halted=engine.plan({...base,state:"halted"});
if(halted.action!=="halt")throw new Error("Halted state was incorrectly resumable.");

const machine=new RecoveryStateMachine();
engine.transitionForAction(machine,"check");
if(machine.current()!=="checking")throw new Error("Resume action transition failed.");

console.log("Recovery resume test passed.");
