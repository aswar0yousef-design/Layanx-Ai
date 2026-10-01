import {HttpRollbackExecutor} from "../src/release/http-rollback-executor.js";
import type {Deployment} from "../src/release/rollback.js";

const deployment:Deployment={
 version:"0.2.0",
 commitSha:"abcdef1234567",
 manifestChecksum:"a".repeat(64),
 deployedAt:new Date().toISOString()
};

let requestBody="";
const ok=new HttpRollbackExecutor({
 endpoint:"https://rollback.invalid",
 fetcher:async(_input,init)=>{requestBody=String(init?.body);return new Response(null,{status:202});}
});
const result=await ok.execute(deployment);
if(!result.success||result.deployment?.commitSha!==deployment.commitSha)throw new Error("HTTP rollback provider did not report success.");
if(!requestBody.includes(deployment.commitSha))throw new Error("Rollback deployment payload was not sent.");

const failed=new HttpRollbackExecutor({
 endpoint:"https://rollback.invalid",
 fetcher:async()=>new Response("failure",{status:500})
});
const failedResult=await failed.execute(deployment);
if(failedResult.success||!failedResult.reason?.includes("500"))throw new Error("HTTP rollback provider did not surface provider failure.");

const network=new HttpRollbackExecutor({
 endpoint:"https://rollback.invalid",
 fetcher:async()=>{throw new Error("provider unavailable");}
});
const networkResult=await network.execute(deployment);
if(networkResult.success||networkResult.reason!=="provider unavailable")throw new Error("HTTP rollback provider did not surface network failure.");

console.log("HTTP rollback provider adapter passed.");
