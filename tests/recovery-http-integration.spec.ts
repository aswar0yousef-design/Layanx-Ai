import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {HttpRollbackExecutor} from "../src/release/http-rollback-executor.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {RecoveryPersistence} from "../src/release/recovery-persistence.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";
import {RollbackController} from "../src/release/rollback.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

let healthCalls=0;
let rollbackCalls=0;
let rollbackPayload="";
const probe=new ReleaseHealthProbe([{
 name:"production",
 check:async()=>++healthCalls>1
}]);
const executor=new HttpRollbackExecutor({
 endpoint:"https://deploy.invalid/rollback",
 fetcher:async(_input,init)=>{
  rollbackCalls++;
  rollbackPayload=String(init?.body);
  return new Response(null,{status:202});
 }
});
const persistence=new RecoveryPersistence(new JsonStorageAdapter("/tmp/layanx-http-recovery.json"));
const rollback=new RollbackController();
rollback.record({
 version:"1.0.0",
 commitSha:"known-good",
 manifestChecksum:"a".repeat(64),
 deployedAt:"2026-01-01T00:00:00Z"
});
const controller=new ProductionRecoveryController(
 probe,
 rollback,
 new RecoveryAuditTrail(),
 executor,
 {maxAttempts:1,persistence,recoveryId:"http-recovery-integration"}
);

const result=await controller.evaluate({
 version:"2.0.0",
 commitSha:"new-deployment",
 manifestChecksum:"b".repeat(64),
 deployedAt:"2026-01-02T00:00:00Z"
});

if(result.decision.action!=="keep")throw new Error("HTTP recovery flow did not finish verified.");
if(result.decision.target?.version!=="1.0.0")throw new Error("HTTP recovery flow did not select the known-good deployment.");
if(result.attempts!==1)throw new Error("HTTP recovery flow did not perform exactly one rollback attempt.");
if(rollbackCalls!==1)throw new Error("HTTP rollback provider was not called exactly once.");
if(!rollbackPayload.includes("known-good"))throw new Error("HTTP rollback payload did not include the known-good deployment.");
if(!result.audit.started||!result.audit.rollback||!result.audit.verified||!result.audit.complete)
 throw new Error("HTTP recovery flow did not produce a complete audit trail.");

console.log("HTTP deployment recovery integration passed.");
