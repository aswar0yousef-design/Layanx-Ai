import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {TWIN_PROGRAM_FILE,disagree,parseTwinInputs,parseTwinRun,twinCases,twinHarnessSource} from "../src/autonomy/twin-check.js";
import {patientCall,patientTimeoutMs} from "../src/core/patient-call.js";

// Inputs: duplicates dropped, odd shapes cleaned, an unusable reply refused.
assert.deepEqual(parseTwinInputs({inputs:[{args:["1"],stdin:""},{args:["1"],stdin:""},{args:[2],stdin:5},{}]}),[{args:["1"],stdin:""},{args:["2"],stdin:""},{args:[],stdin:""}]);
assert.throws(()=>parseTwinInputs({}),/no inputs array/);

// The harness really runs both programs through node --test and reports what each gave.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-twin-"));
fs.mkdirSync(path.join(dir,"src"));fs.mkdirSync(path.join(dir,"tests"));fs.mkdirSync(path.join(dir,".layanx","twin"),{recursive:true});
fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({type:"module",scripts:{test:"node --test"}}));
// The main program has a planted bug: words split on a single space only.
fs.writeFileSync(path.join(dir,"src","index.mjs"),"let t='';for await(const c of process.stdin)t+=c;process.stdout.write(String(t.split(' ').filter(Boolean).length));");
fs.writeFileSync(path.join(dir,TWIN_PROGRAM_FILE),"let t='';for await(const c of process.stdin)t+=c;process.stdout.write(String(t.split(/\\s+/).filter(Boolean).length));");
fs.writeFileSync(path.join(dir,"tests","zz-layanx-twin.test.mjs"),twinHarnessSource([{args:[],stdin:"a b"},{args:[],stdin:"a\tb  c\n"},{args:[],stdin:""}],"src/index.mjs"));
const run=spawnSync(process.execPath,["--test"],{cwd:dir,encoding:"utf8",windowsHide:true});
assert.equal(run.status,0,run.stdout+run.stderr);
const runs=parseTwinRun(run.stdout);
assert.equal(runs.length,3);
assert.deepEqual(runs.map(disagree),[false,true,false]);
const cases=twinCases(runs);
assert.equal(cases.length,1);
assert.deepEqual({stdin:cases[0]!.stdin,code:cases[0]!.code,stdout:cases[0]!.stdout},{stdin:"a\tb  c\n",code:0,stdout:"3"});
fs.rmSync(dir,{recursive:true,force:true});

// A failure's wording does not count; a twin that fails on most inputs is ignored as broken.
const r=(main:[number,string],twin:[number,string])=>({args:[],stdin:"",main:{code:main[0],stdout:main[1]},twin:{code:twin[0],stdout:twin[1]}});
assert.equal(disagree(r([1,"x"],[2,"y"])),false);
assert.equal(disagree(r([0,'{"a":1}'],[0,'{ "a": 1 }'])),false);
assert.deepEqual(twinCases([r([0,"1"],[1,""]),r([0,"2"],[1,""]),r([0,"3"],[0,"4"])]),[]);

// A timeout gets one more try with the same call and a longer limit; other errors are not retried.
const limits:Array<number|undefined>=[];
assert.equal(await patientCall(async limit=>{limits.push(limit);if(limits.length===1)throw new Error("ollama: This operation was aborted");return"ok";},{env:{}}),"ok");
assert.deepEqual(limits,[undefined,300000]);
let calls=0;
await assert.rejects(patientCall(async()=>{calls++;throw new Error("model not found");},{env:{}}),/model not found/);
assert.equal(calls,1);
assert.equal(patientTimeoutMs({OLLAMA_TIMEOUT_MS:"300000"}),500000);
await assert.rejects(patientCall(async()=>{throw new Error("timed out");},{env:{LAYANX_PATIENT_RETRY:"off"}}),/timed out/);
console.log("twin check: two programs are compared by running them, disagreements need a blind confirmation, and a timeout gets one patient retry");
