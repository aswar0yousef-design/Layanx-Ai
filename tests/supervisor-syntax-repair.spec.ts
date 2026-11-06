import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-syntax-gate-"));
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
process.env.LAYANX_STORE_DIR=path.join(root,"store");
const id="syntax-gate";
const project=path.join(process.env.LAYANX_WORKSPACE_ROOT,id);
fs.mkdirSync(project,{recursive:true});
let agentCalls=0;
const deps:SupervisorDeps={
 async think(){return JSON.stringify({
  acceptance:["Create a Node HTTP task app"],
  milestones:[{title:"Create package.json and src/server.mjs",
    goal:"Write package.json and src/server.mjs",kind:"code"}],
  checks:{install:false,test:false,build:true,typecheck:false,lint:false,security:false,browser:null}
 });},
 async runAgent(){
  agentCalls++;
  fs.mkdirSync(path.join(project,"src"),{recursive:true});
  fs.writeFileSync(path.join(project,"package.json"),
    JSON.stringify({name:"syntax-gate",type:"module",scripts:{build:"node --check src/server.mjs"}}));
  // The same real syntax failure observed on the owner's Ollama machine.
  fs.writeFileSync(path.join(project,"src","server.mjs"),
    "export const createServer = () => ({end(x){return x;}});\nconst res = createServer();\nres.end('<html>\n<body>Tasks</body>\n</html>');\n");
  return {completed:true,missionId:"write-syntax-gate-"+agentCalls};
 },
 async resumeAgent(){throw new Error("Unexpected resume");},
 async runTool(_projectId,tool,payload){
  if(tool==="project.run"&&payload.task==="build"){
    const result=spawnSync(process.execPath,["--check","src/server.mjs"],
      {cwd:project,encoding:"utf8",timeout:4000,windowsHide:true});
    return {ok:result.status===0,data:{ok:result.status===0,exitCode:result.status,
      stdout:result.stdout??"",stderr:result.stderr??""}};
  }
  return {ok:true,data:{ok:true,exitCode:0}};
 },
 isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
let sup:Supervisor|undefined;
try{
  sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:5});
  const job=sup.create("Create a simple task app",id,{acceptanceProfile:"task-app-http-v1",maxRounds:3});
  const deadline=Date.now()+12000;
  while(sup.get(job.id)?.milestones[0]?.status!=="done"&&Date.now()<deadline)
    await new Promise(resolve=>setTimeout(resolve,20));
  const state=sup.get(job.id)!;
  assert.equal(state.milestones[0]?.status,"done","Supervisor must independently verify a syntax repair");
  assert.equal(state.milestones[0]?.attempts,1,"A repairable syntax error must not waste four full model attempts");
  assert.equal(agentCalls,1,"The initial model tool run should be enough for this narrow syntax error");
  assert.ok(state.log.some(log=>log.msg.includes("Repaired broken multiline HTML literal")));
  const check=spawnSync(process.execPath,["--check",path.join(project,"src","server.mjs")],{encoding:"utf8"});
  assert.equal(check.status,0,"The produced file must actually pass Node syntax check");
}finally{if(sup)sup.stop();fs.rmSync(root,{recursive:true,force:true});}
console.log("Supervisor rechecks real build after bounded local syntax repair, without another model attempt");
