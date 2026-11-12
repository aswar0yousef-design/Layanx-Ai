import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {IdleTrainer,nextPractice,practiceOutcome,harvestLessons,PRACTICES,type PracticeRecord} from "../src/autonomy/idle-trainer.js";
import {listLessons} from "../src/autonomy/learning.js";

// The order of practice: untried first, then the weakest, then the least recently practised.
const at=(m:number)=>new Date(Date.UTC(2026,10,12,0,m)).toISOString();
const rec=(practice:string,ok:boolean,m:number):PracticeRecord=>({at:at(m),practice,ok,minutes:1});
const two=[{id:"a",args:[]},{id:"b",args:[]},{id:"c",args:[]}];
assert.equal(nextPractice([rec("a",true,1),rec("b",true,2)],two).id,"c","never tried comes first");
assert.equal(nextPractice([rec("a",true,1),rec("b",false,2),rec("c",true,3)],two).id,"b","the weakest next");
assert.equal(nextPractice([rec("a",true,5),rec("b",true,2),rec("c",true,3)],two).id,"b","then the least recent");
assert.ok(PRACTICES.length>=15&&PRACTICES.every(p=>p.args[0]!.startsWith("scripts/outcome-")));

assert.deepEqual(practiceOutcome('noise\n{\n  "report": "C:\\\\x\\\\r.json",\n  "summary": {\n    "runs": 1,\n    "passed": 1\n  }\n}\n'),{passed:1,runs:1,report:"C:\\x\\r.json"});
assert.equal(practiceOutcome("crashed"),null);

// Lessons learned in a practice run reach the main memory.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"trainer-"));
const run=path.join(root,"run1");fs.mkdirSync(path.join(run,"store"),{recursive:true});fs.mkdirSync(path.join(run,"projects","p"),{recursive:true});
fs.writeFileSync(path.join(run,"store","lessons.json"),JSON.stringify([{stack:"node",kind:"fix",signature:"sig-require-mjs",trigger:"require is not defined in ES module scope",text:"In an .mjs file use import, not require."}]));
const report=path.join(root,"report.json");fs.writeFileSync(report,JSON.stringify({records:[{workspace:path.join(run,"projects","p")}]}));
const env={...process.env,LAYANX_LESSONS_FILE:path.join(root,"main-lessons.json")};
assert.equal(harvestLessons(report,env),1);
assert.equal(harvestLessons(report,env),0,"not copied twice");
assert.equal(listLessons(env)[0]!.projectId,"practice");

// It starts only when nobody is working or at the keyboard, and stops when the owner comes back.
let clock=Date.UTC(2026,10,12,10,0),owner=clock-60*60_000,idle=60*60_000,busy=false;
const launched:string[][]=[];let child:any;
const trainer=new IdleTrainer({ledgerFile:path.join(root,"ledger.json"),logFile:path.join(root,"log.txt"),storeEnv:env,busy:()=>busy,lastOwnerActivity:()=>owner,userIdleMs:async()=>idle,now:()=>clock,
  launch:(args)=>{launched.push(args);child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),pid:undefined,kill(){this.emit("exit",null);}});return child;},practices:two});
busy=true;assert.equal(await trainer.tick(),"waiting","real work comes first");busy=false;
{const t2=new IdleTrainer({ledgerFile:path.join(root,"l2.json"),logFile:path.join(root,"log2.txt"),busy:()=>false,lastOwnerActivity:()=>owner,userIdleMs:async()=>idle,now:()=>clock,gpuInUse:async()=>true,launch:()=>{throw new Error("must not start");},practices:two});
 assert.equal(await t2.tick(),"waiting","the model is in use by someone else");}
idle=30_000;assert.equal(await trainer.tick(),"waiting","someone is at the keyboard");idle=60*60_000;
assert.equal(await trainer.tick(),"started");
assert.equal(trainer.status().training?.practice,"a");
child.stdout.write('{\n  "report": "'+report.replace(/\\/g,"\\\\")+'",\n  "summary": {\n    "runs": 1,\n    "passed": 1\n  }\n}\n');
await new Promise(r=>setTimeout(r,20));
child.emit("exit",0);
assert.equal(trainer.ledger().records.at(-1)!.ok,true);
assert.equal(await trainer.tick(),"waiting","a short gap between practices");
clock+=11*60_000;
assert.equal(await trainer.tick(),"started");
owner=clock;assert.equal(await trainer.tick(),"stopped","the owner is back");
assert.equal(trainer.ledger().records.at(-1)!.stopped,"owner returned");
assert.equal(trainer.status().practised,1,"a stopped practice is not counted as a result");
fs.rmSync(root,{recursive:true,force:true});
// Wired in: the server marks owner activity and serves the status; the Learning page shows it.
const api=fs.readFileSync(new URL("../src/api-server.ts",import.meta.url),"utf8"),app=fs.readFileSync(new URL("../web/app.js",import.meta.url),"utf8");
assert.match(api,/request\.method!=="GET"[^\n]*lastOwnerActivity=Date\.now\(\)/);
assert.match(api,/trainer\.schedule\(\)/);
assert.match(app,/trainL:"التعلم في وقت الفراغ"/);
assert.match(app,/api\("\/v1\/training"\)/);
console.log("idle-trainer: practises only when idle, weakest first, stops when the owner returns, and keeps what it learned");
