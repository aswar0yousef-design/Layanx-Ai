import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {PROCESS_RUN_ID} from "../src/core/runtime.js";
import {reapOrphanRuns} from "../src/autonomy/project-runner.js";

setInterval(()=>undefined,1000);
const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-crash-"));
process.env.LAYANX_STORE_DIR=root;
const runsFile=path.join(root,"active-runs.json");
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const spawnIdle=async()=>{const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{windowsHide:true,stdio:"ignore"});await wait(300);return child;};
const DEAD_OWNER=999_999;

// A task left behind by a process that is gone is stopped.
const orphan=await spawnIdle();
fs.writeFileSync(runsFile,JSON.stringify([{pid:orphan.pid,owner:DEAD_OWNER,cwd:root,label:"npm test",startedAt:new Date().toISOString()}]));
assert.deepEqual(reapOrphanRuns(),{stopped:["npm test"],left:[]});
await wait(300);
assert.equal(alive(orphan.pid!),false);
assert.deepEqual(JSON.parse(fs.readFileSync(runsFile,"utf8")),[]);

// An id that now belongs to a different process (ids get reused) is never killed.
const stranger=await spawnIdle();
fs.writeFileSync(runsFile,JSON.stringify([{pid:stranger.pid,owner:DEAD_OWNER,cwd:root,label:"old task",startedAt:new Date(Date.now()-3600_000).toISOString()}]));
assert.deepEqual(reapOrphanRuns(),{stopped:[],left:["old task"]});
assert.equal(alive(stranger.pid!),true);

// A task of a LayanX that is still running is left alone.
fs.writeFileSync(runsFile,JSON.stringify([{pid:stranger.pid,owner:process.pid,cwd:root,label:"mine",startedAt:new Date().toISOString()}]));
assert.deepEqual(reapOrphanRuns(),{stopped:[],left:[]});
assert.equal(alive(stranger.pid!),true);
assert.equal(JSON.parse(fs.readFileSync(runsFile,"utf8")).length,1);
stranger.kill();

// A mission restored with a tool still marked in flight is shown as interrupted, and the tool does not run again.
const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"t",allowedTools:["t.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:5,maxRuntimeMs:1000,successCriteria:[],stopCondition:"stop"});
core.tools.register({name:"t.run",actions:["run"],permission:"L1_READ",description:"t"} as never);
let runs=0;
core.toolAdapters.register("t.run",{execute:async()=>{runs++;return{ok:true,data:{}};}} as never);
const planned=core.startMission("run it","p1");
planned.tools=[{tool:"t.run",action:"run",permission:"L1_READ",reason:"t",payload:{}}];planned.requiredPermission="L1_READ";planned.status="running";
const state=core.executionStates.get(planned.id)!;
const restored=core.restoreRuntimeSnapshot({mission:{...planned,inFlight:{tool:"t.run",action:"run",startedAt:new Date().toISOString(),runId:"previous-process"}},executionState:state,ledger:[],audit:[],savedAt:new Date().toISOString(),schemaVersion:1})!;
assert.equal(restored.status,"blocked");
const result=await core.executeMissionTool(restored.id,"p1",0,{},undefined,"core");
assert.equal(result.ok,false);
assert.match(result.error??"",/Interrupted by a restart/);
assert.equal(runs,0);

// The same marker from this very process is an ordinary step, and it is cleared when the tool returns.
const own=core.startMission("run it too","p1");
own.tools=[{tool:"t.run",action:"run",permission:"L1_READ",reason:"t",payload:{}}];own.requiredPermission="L1_READ";own.inFlight={tool:"t.run",action:"run",startedAt:new Date().toISOString(),runId:PROCESS_RUN_ID};
core.missions.save(own);
const fine=await core.executeMissionTool(own.id,"p1",0,{},undefined,"core");
assert.equal(fine.ok,true,String(fine.error));
assert.equal(runs,1);
assert.equal(core.missions.get(own.id)!.inFlight,undefined);

console.log("crash-interrupted-tool: an interrupted tool is not repeated, and tasks left by a crash are stopped safely");
process.exit(0);
