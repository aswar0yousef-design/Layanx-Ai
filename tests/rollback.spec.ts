import {RollbackController} from "../src/release/rollback.js";

const r=new RollbackController();
r.record({version:"1.0.0",commitSha:"a",manifestChecksum:"a",deployedAt:"2026-01-01T00:00:00Z"});
r.record({version:"1.1.0",commitSha:"b",manifestChecksum:"b",deployedAt:"2026-01-02T00:00:00Z"});

const failed=r.decide({healthy:false,reason:"health check failed"});
if(failed.action!=="rollback"||failed.target?.version!=="1.0.0"||!failed.requiresVerification)
 throw new Error("Rollback target or verification requirement incorrect.");

const verified=r.verifyRollback(failed.target,{healthy:true});
if(verified.action!=="keep"||verified.target?.version!=="1.0.0"||verified.requiresVerification)
 throw new Error("Healthy rollback verification was not accepted.");

const failedVerification=r.verifyRollback(failed.target,{healthy:false,reason:"database check failed"});
if(failedVerification.action!=="halt"||!failedVerification.reason)
 throw new Error("Failed rollback verification did not halt recovery.");

const healthy=r.decide({healthy:true});
if(healthy.action!=="keep"||healthy.requiresVerification)
 throw new Error("Healthy deployment was not kept safely.");

const empty=new RollbackController();
const halted=empty.decide({healthy:false});
if(halted.action!=="halt")throw new Error("Missing last-known-good deployment was not halted.");

console.log("Rollback test passed.");
