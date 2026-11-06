import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-supervisor-artifact-gate-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
const projectId="artifact-gate";
const project=path.join(process.env.LAYANX_WORKSPACE_ROOT,projectId);
fs.mkdirSync(project,{recursive:true});
fs.writeFileSync(path.join(project,"package.json"),JSON.stringify({
  name:"artifact-gate",type:"module",scripts:{test:"node --test",build:"node --check app.mjs"}
}));
const deps:SupervisorDeps={
  async think(){return JSON.stringify({
    acceptance:["Prove the generated output exists"],
    milestones:[{title:"Build output",goal:"Produce the output",kind:"code"}],
    checks:{test:true,build:true,browser:null,security:false}
  });},
  async runAgent(){return {completed:true,missionId:"mock-agent"};},
  async resumeAgent(){return {completed:true};},
  async runTool(_projectId,tool){
    if(tool==="project.security")return {ok:true,data:{score:100,blocked:false,counts:{}}};
    return {ok:true,data:{ok:true,exitCode:0}};
  },
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
const until=async(getStatus:()=>string,timeoutMs=15000)=>{
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
    const status=getStatus();
    if(status==="completed"||status==="failed"||status==="budget_exhausted")return status;
    await new Promise(resolve=>setTimeout(resolve,15));
  }
  throw Error("Supervisor did not finish before timeout.");
};
const receipt={requirementId:"output",checkId:"test",passed:true,
  artifact:"reports/output.json",observedAt:new Date().toISOString()};
const requirements=[{id:"output",description:"Output file exists after verification",required:true,checkId:"test" as const,artifact:"reports/output.json"}];
const sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:5});
try{
  const missing=sup.create("Generate verifiable output",projectId,{maxRounds:10,requiredAcceptance:requirements});
  missing.acceptanceProofs=[{...receipt}];
  assert.equal(await until(()=>sup.get(missing.id)!.status),"failed",
    "Passing mock test/build and an invented path must not certify completion");
  assert.match(sup.get(missing.id)!.outcome?.blockers.join(" ")??"",/Artifact file does not exist/);
  assert.equal(sup.get(missing.id)!.finalRepairs,2,"Retries remain bounded");

  fs.mkdirSync(path.join(project,"reports"),{recursive:true});
  fs.writeFileSync(path.join(project,"reports","output.json"),'{"status":"created"}');
  const present=sup.create("Generate verifiable output",projectId,{maxRounds:10,requiredAcceptance:requirements});
  // No manual receipt: the successful final test must generate one.
  assert.equal(await until(()=>sup.get(present.id)!.status),"completed",
    "A real existing artifact plus passing checks can satisfy the strict contract");
  assert.equal(sup.get(present.id)!.outcome?.status,"verified");
  const evidence=sup.get(present.id)!.outcome?.evidence.find(e=>e.name==="acceptance:output");
  assert.equal(evidence?.passed,true,"Accepted requirement has a recorded independent proof");
  assert.equal(evidence?.reference,"project-artifact:reports/output.json");
  const report=JSON.parse(fs.readFileSync(path.join(project,".layanx","outcomes",present.id+".json"),"utf8"));
  assert.ok(report.evidence.some((e:{name:string;reference:string})=>
    e.name==="acceptance:output"&&e.reference==="project-artifact:reports/output.json"),
    "Acceptance evidence survives in the delivery report on disk");
  const forged=sup.create("Generate verifiable output",projectId,{maxRounds:10,requiredAcceptance:[{id:"output",description:"Only independently observed execution counts",required:true}]});
  forged.acceptanceProofs=[{...receipt,checkId:"not-run:e2e"}];
  assert.equal(await until(()=>sup.get(forged.id)!.status),"failed",
    "An invented test name cannot certify an existing artifact");
  assert.match(sup.get(forged.id)!.outcome?.blockers.join(" ")??"",/not independently executed/);
  console.log("supervisor artifact gate: missing files and unexecuted checks block delivery; a real file with passing test permits delivery");
}finally{sup.stop();fs.rmSync(root,{recursive:true,force:true});}
