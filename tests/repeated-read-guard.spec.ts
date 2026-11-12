import assert from "node:assert/strict";
import {readSignature,repeatedReadReason} from "../src/core/repeated-read-guard.js";

const read={tool:"project.knowledge",action:"read project knowledge",permission:"L1_READ",payload:{query:"hello",limit:5}};
const first=readSignature(read);
assert.ok(first);
assert.equal(repeatedReadReason(read,[]),null);
assert.equal(repeatedReadReason(read,[first!]),null,"One repeat can be useful");
assert.match(repeatedReadReason(read,[first!,first!])??"",/Repeated read-only tool blocked/);
assert.equal(readSignature({...read,payload:{limit:5,query:"hello"}}),first,"Object key order should not matter");
assert.equal(repeatedReadReason({...read,payload:{query:"different",limit:5}},[first!,first!]),null,"A new query is different work");
assert.equal(repeatedReadReason({...read,permission:"L3_MODIFY"},[first!,first!]),null,"Never block mutations with a read-only rule");
assert.equal(readSignature({tool:"desktop.mouse.click",action:"click",permission:"L1_READ",payload:{x:1}}),null,"Never silently classify side effects as reads");
assert.equal(readSignature({tool:"terminal.exec",action:"run",permission:"L1_READ",payload:{command:"echo hi"}}),null,"Shell calls must not be treated as safe reads");
assert.ok(readSignature({tool:"files.list",action:"list files",permission:"L1_READ",payload:{path:"."}}));
assert.ok(readSignature({tool:"runtime.status",action:"read runtime status",permission:"L1_READ"}));
assert.ok(readSignature({tool:"mission.inspect",action:"inspect mission",permission:"L2_ANALYZE"}));
console.log("repeated-read-guard: third identical successful observation is blocked, changed queries and mutations are allowed");

// Repeated failures (seen live: research.internet failed ten times with "spawn agent-reach ENOENT").
const {failedCall,repeatedFailureReason}=await import("../src/core/repeated-read-guard.js");
const research=(query:string)=>({tool:"research.internet",action:"research internet",permission:"L2_ANALYZE",payload:{query}});
const enoent="Error: spawn agent-reach ENOENT";
assert.equal(repeatedFailureReason(research("a"),[]),null);
assert.equal(repeatedFailureReason(research("b"),[failedCall(research("a"),enoent)]),null,"one failure may be repaired");
assert.match(repeatedFailureReason(research("c"),[failedCall(research("a"),enoent),failedCall(research("b"),enoent)])!,/already failed twice with the same error.*enoent/);
assert.match(repeatedFailureReason(research("a"),[failedCall(research("a"),"timeout after 1000 ms"),failedCall(research("a"),"timeout after 2000 ms")])!,/same arguments/);
assert.equal(repeatedFailureReason(research("c"),[failedCall(research("a"),"not found: a"),failedCall(research("b"),"not found: b")]),null,"different errors: the repairs are still learning something");
assert.equal(repeatedFailureReason({...research("a"),tool:"http.read"},[failedCall(research("a"),enoent),failedCall(research("b"),enoent)]),null,"another tool is still allowed");
console.log("repeated-read-guard: a third attempt after the same failure twice is blocked");
