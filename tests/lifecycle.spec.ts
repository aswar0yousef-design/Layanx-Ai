import {strict as assert} from "node:assert";
import {setLifecycle} from "../src/core/lifecycle.js";
import {ExecutionStateStore} from "../src/core/execution-state.js";
import type {Mission} from "../src/core/types.js";

function mission():Mission{
 return{
  id:"lifecycle-test",
  goal:"lifecycle",
  status:"running",
  risk:"low",
  requiredPermission:"L1_READ",
  steps:[],
  createdAt:new Date().toISOString(),
  projectId:"default"
 };
}

const states=new ExecutionStateStore();
const m=mission();
states.start(m.id);

for(const [status,execution,recoverable] of [
 ["running","running",true],
 ["verifying","running",true],
 ["completed","completed",false],
 ["failed","failed",true],
 ["failed","failed",false],
 ["blocked","blocked",false],
 ["cancelled","blocked",false]
] as const){
 setLifecycle(m,states,status,recoverable);
 const current=states.get(m.id)!;
 assert.equal(m.status,status);
 assert.equal(current.status,execution);
 assert.equal(current.recoverable,recoverable);
}

console.log("Lifecycle transitions: PASS");
