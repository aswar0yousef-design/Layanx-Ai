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
  assert.equal(finished.outcome?.status,"blocked");
  assert.equal(finished.behavior?.ok,false);
  assert.ok(finished.outcome?.evidence.some(e=>e.reference==="independent:http:task-app"&&!e.passed));
  assert.ok(finished.finalRepairs<=2,"Behavior failures must terminate after a bounded number of repairs");
  const recovered=new Supervisor(deps,{file:path.join(root,"jobs.json")});
  assert.equal(recovered.get(job.id)?.outcome?.status,"blocked","Restart preserves the rejection");
  assert.equal(recovered.get(job.id)?.behavior?.ok,false);
  sup.stop();recovered.stop();
  console.log("outcome-profile-gate: mock agent success cannot override failed real behavior and persisted evidence");
}finally{fs.rmSync(root,{recursive:true,force:true});}
