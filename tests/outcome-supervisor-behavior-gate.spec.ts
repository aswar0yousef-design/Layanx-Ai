import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

// Even successful mocked build/test calls cannot certify a missing HTTP application.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-profile-gate-"));
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
process.env.LAYANX_STORE_DIR=path.join(root,"store");
const project="task-app-profile-gate";
const workspace=path.join(process.env.LAYANX_WORKSPACE_ROOT,project);
fs.mkdirSync(workspace,{recursive:true});
fs.writeFileSync(path.join(workspace,"package.json"),JSON.stringify({
  name:"task-app-profile-gate",type:"module",scripts:{test:"node --test",build:"node --check src/server.mjs"}
}));
fs.mkdirSync(path.join(workspace,"src"),{recursive:true});
// Nonempty but nonfunctional output: a mocked successful build is NEVER
// acceptable proof of a running HTTP server. The independent probe must
// reject this during stage 2, before delivery.
fs.writeFileSync(path.join(workspace,"src","server.mjs"),
  "export function createServer(){return {status:'not-an-http-server'};}\n");
const deps:SupervisorDeps={
  async think(){return JSON.stringify({
    acceptance:["Create, delete and retain tasks across application restarts"],
    milestones:[{title:"Create app",goal:"Generate a task application",kind:"code"}],
    checks:{test:true,build:true,security:false,browser:null}
  });},
  async runAgent(){return {completed:true,missionId:"mock-agent-claimed-done"};},
  async resumeAgent(){throw new Error("Unexpected approval");},
  async runTool(_p,tool){
    if(tool==="project.security")return {ok:true,data:{score:100,blocked:false,counts:{}}};
    return {ok:true,data:{ok:true,exitCode:0}};
  },
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
async function until(getStatus:()=>string,maxMs=12000){
  const end=Date.now()+maxMs;
  while(Date.now()<end){const status=getStatus();if(["completed","failed","budget_exhausted"].includes(status))return status;
    await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error("Supervisor job did not terminate");
}
try{
  const sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:10});
  const job=sup.create("Create a local task API",project,{acceptanceProfile:"task-app-http-v1",maxRounds:15});
  const status=await until(()=>sup.get(job.id)!.status);
  assert.equal(status,"failed","Never claim completion without the generated app");
  const finished=sup.get(job.id)!;
  assert.notEqual(finished.outcome?.status,"verified",
    "The new early gate must never publish verified delivery for an invalid server");
  assert.equal(finished.milestones[0]?.status,"done","A real valid package contract passes stage 1");
  assert.equal(finished.milestones[1]?.status,"failed","Stage 2 rejects a fake HTTP server");
  assert.equal(finished.behavior?.ok,false,"Independent HTTP behavior probe must run and fail");
  assert.ok(finished.behavior?.checks.some(c=>c.name==="start"&&!c.ok),
    "The independent probe must observe that createServer returns no HTTP server");
  assert.match(finished.milestones[1]?.notes??"",/HTTP behavior failed/,
    "Actual HTTP failure must be visible in the coding agent's repair feedback");
  assert.equal(finished.finalRepairs,0,"Do not waste final verification retries for a failed server milestone");
  const recovered=new Supervisor(deps,{file:path.join(root,"jobs.json")});
  assert.equal(recovered.get(job.id)?.status,"failed","Restart preserves the early rejection");
  assert.equal(recovered.get(job.id)?.behavior?.ok,false,"Restart preserves independent failure evidence");
  sup.stop();recovered.stop();
  console.log("outcome-profile-gate: invalid HTTP server rejected during stage 2; independent behavior evidence persisted");
}finally{fs.rmSync(root,{recursive:true,force:true});}
