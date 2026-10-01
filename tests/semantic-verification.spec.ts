import {VerificationEngine} from "../src/core/verification.js";
import type {Mission} from "../src/core/types.js";

const mission:Mission={
 id:"verification-test",goal:"verify result",status:"verifying",risk:"low",requiredPermission:"L1_READ",
 steps:[{id:"execute",description:"Execute requested action",status:"completed"}],
 createdAt:"2026-01-01T00:00:00Z"
};

const engine=new VerificationEngine();

const valid=engine.verify(mission,{created:true,count:10,text:"hello world",items:[1,2,3]},[
 "result.created == true",
 "result.count >= 10",
 "result.text contains hello",
 "result.items.length == 3"
]);
if(!valid.verified)throw new Error("Valid semantic criteria were not verified.");

const failed=engine.verify(mission,{created:false,count:4},["result.created == true","result.count >= 10"]);
if(failed.verified||failed.failures.length!==2)throw new Error("Failed semantic criteria were incorrectly accepted.");

const missing=engine.verify(mission,{created:true},["result.missing == true"]);
if(missing.verified||!missing.failures.some(item=>item.includes("path not found")))throw new Error("Missing result path was not rejected.");

const unsupported=engine.verify(mission,{created:true},["file was created"]);
if(unsupported.verified||!unsupported.failures.some(item=>item.includes("Unsupported success criterion")))throw new Error("Unsupported natural-language criterion was silently accepted.");

console.log("Semantic verification test passed.");
