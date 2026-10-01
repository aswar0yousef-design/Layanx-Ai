import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {RollbackController} from "../src/release/rollback.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";

let calls=0;
const probe=new ReleaseHealthProbe([{
 name:"api",
 check:async()=>++calls>1
}]);
const audit=new RecoveryAuditTrail();
const rollback=new RollbackController();
const controller=new ProductionRecoveryController(probe,rollback,audit,{maxAttempts:1});

const result=await controller.evaluate({
 version:"1.1.0",
 commitSha:"bad1234",
 manifestChecksum:"b".repeat(64),
 deployedAt:"2026-01-02T00:00:00Z"
});

if(result.decision.action!=="keep")throw new Error("Recovery controller did not verify the rollback target.");
if(result.decision.target?.version!=="1.0.0")throw new Error("Recovery controller selected the wrong deployment.");
if(result.attempts!==1)throw new Error("Recovery controller attempt count is incorrect.");
if(!result.audit.started||!result.audit.rollback||!result.audit.verified||!result.audit.complete)
 throw new Error("Recovery controller did not produce a complete audit trail.");

const healthyProbe=new ReleaseHealthProbe([{name:"api",check:async()=>true}]);
const healthy=new ProductionRecoveryController(healthyProbe,new RollbackController(),new RecoveryAuditTrail());
const healthyResult=await healthy.evaluate({
 version:"2.0.0",
 commitSha:"good1234",
 manifestChecksum:"c".repeat(64),
 deployedAt:"2026-01-03T00:00:00Z"
});
if(healthyResult.decision.action!=="keep"||healthyResult.attempts!==0)
 throw new Error("Healthy deployment was unnecessarily recovered.");

console.log("Production recovery controller test passed.");
