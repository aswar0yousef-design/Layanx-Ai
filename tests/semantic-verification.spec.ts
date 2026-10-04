import {VerificationEngine} from "../src/core/verification.js";
import type {Mission} from "../src/core/types.js";

function mission():Mission{
 return{
  id:"verification-test",
  goal:"verify result",
  status:"verifying",
  risk:"low",
  requiredPermission:"L1_READ",
  steps:[
   {id:"execute",description:"Execute requested action",status:"completed"},
   {id:"verify",description:"Verify result",status:"pending"}
  ],
  successCriteria:[],
  stopCondition:"stop"
 };
}
const engine=new VerificationEngine();

for(const [criteria,result] of [
 ["result.status === \"ok\"",{status:"ok"}],
 ["result.status !== \"failed\"",{status:"ok"}],
 ["result.count >= 3",{count:4}],
 ["result.count < 3",{count:2}],
 [`result.message contains "done"`,{message:"task done successfully"}],
 ["result.items.length === 2",{items:["a","b"]}],
 ["result.items.length > 2",{items:["a","b","c"]}]
] as Array<[string,unknown]>){
 const value=engine.verify(mission(),result,[criteria]);
 if(!value.verified)throw new Error(`Supported criterion failed: ${criteria}: ${value.failures.join("; ")}`);
}

for(const [criteria,result] of [
 [`result.status === "ok"`,{status:"failed"}],
 ["result.count > 5",{count:2}],
 ["result.count < 3",{count:3}],
 [`result.message contains "done"`,{message:"pending"}],
 ["result.items.length === 2",{items:["a"]}],
 [`result.status matches "ok"`,{status:"ok"}]
] as Array<[string,unknown]>){
 const value=engine.verify(mission(),result,[criteria]);
 if(value.verified)throw new Error(`Criterion incorrectly verified: ${criteria}`);
}

const empty=engine.verify(mission(),{status:"ok"},[""]);
if(empty.verified||!empty.failures.some(x=>x.includes("empty item")))throw new Error("Empty criteria was not rejected.");

const nullResult=engine.verify(mission(),undefined,[`result.status === "ok"`]);
if(nullResult.verified||!nullResult.failures.some(x=>x.includes("no result")))throw new Error("Undefined result was not rejected.");

console.log("Semantic verification tests passed.");
