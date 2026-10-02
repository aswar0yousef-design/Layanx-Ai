import {MemoryEngine} from "../src/core/memory.js";
import {FailureLearning} from "../src/core/failure-learning.js";

const memory=new MemoryEngine();
const learning=new FailureLearning(memory);
const first=learning.record({missionId:"m1",projectId:"p1",error:"HTTP 503 service unavailable",tool:"http",action:"read",recoverable:true});
if(first.category!=="network"||!first.signature.includes("network"))throw new Error("Failure category normalization failed.");
const similar=learning.recallSimilar("network http service unavailable","p1");
if(similar.length!==1||similar[0].kind!=="failure")throw new Error("Similar failure was not recalled.");
const isolated=learning.recallSimilar("network http service unavailable","p2");
if(isolated.length!==0)throw new Error("Failure memory crossed project boundary.");
console.log("Failure learning tests passed.");
