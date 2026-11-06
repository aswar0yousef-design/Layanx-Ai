import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

// A hallucinated "completed" tool mission MUST NOT certify source files
// that the local model never wrote. No build or test checks exist yet.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-artifact-gate-"));
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
process.env.LAYANX_STORE_DIR=path.join(root,"store");
const id="strict-artifact-milestone";
fs.mkdirSync(path.join(process.env.LAYANX_WORKSPACE_ROOT,id),{recursive:true});
let calls=0;
const deps:SupervisorDeps={
 async think(){return JSON.stringify({
   acceptance:["Working Node HTTP application"],
   milestones:[{title:"Create package.json and src/server.mjs",goal:"Write package.json and src/server.mjs",kind:"code"}],
   checks:{install:false,test:false,build:false,typecheck:false,lint:false,security:false,browser:null}
 });},
 async runAgent(){calls++;return{completed:true,missionId:"claimed-"+calls};},
 async resumeAgent(){throw new Error("Unexpected resume");},
 async runTool(){return{ok:true,data:{ok:true,exitCode:0}};},
 isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
try{
 const sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:5});
 const repairHint=(sup as unknown as {syntaxRepairHint:(notes?:string)=>string}).syntaxRepairHint;
 const syntaxError="build failed:\\nC:\\\\workspace\\\\src\\\\server.mjs:6\\n  res.end('<html>\\nSyntaxError: Invalid or unexpected token";
 assert.match(repairHint(syntaxError),/template literal/,"A real broken HTML string should trigger targeted repair guidance");
 assert.match(repairHint(syntaxError),/node --check/);
 assert.equal(repairHint("Failed test assertion"),"","Unrelated failures must not get speculative syntax fixes");
 const job=sup.create("Create a persistent Node HTTP task app",id,{acceptanceProfile:"task-app-http-v1",maxRounds:12});
 const deadline=Date.now()+12000;
 while(!["failed","completed"].includes(sup.get(job.id)!.status)&&Date.now()<deadline)
   await new Promise(resolve=>setTimeout(resolve,15));
 const state=sup.get(job.id)!;
 assert.equal(state.status,"failed","Missing files must fail at first coding milestone");
 assert.equal(state.milestones[0]?.attempts,4);
 assert.equal(state.finalRepairs,0,"Should not waste time on final verification for missing artifacts");
 assert.match(state.milestones[0]?.notes??"",/Missing or empty package.json/);
 assert.match(state.milestones[0]?.notes??"",/Missing or empty src\/server.mjs/);
 assert.ok(!fs.existsSync(path.join(root,"projects",id,"src","server.mjs")));
 sup.stop();
 console.log("Strict artifact gate: fake completion cannot pass absent source files");
}finally{fs.rmSync(root,{recursive:true,force:true});}
