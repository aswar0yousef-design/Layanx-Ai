import {RollbackController} from "../src/release/rollback.js";
const r=new RollbackController();
r.record({version:"1.0.0",commitSha:"a",manifestChecksum:"a",deployedAt:"2026-01-01T00:00:00Z"});
r.record({version:"1.1.0",commitSha:"b",manifestChecksum:"b",deployedAt:"2026-01-02T00:00:00Z"});
const d=r.decide({healthy:false,reason:"health check failed"});
if(d.action!=="rollback"||d.target?.version!=="1.0.0")throw new Error("Rollback target incorrect.");
console.log("Rollback test passed.");
