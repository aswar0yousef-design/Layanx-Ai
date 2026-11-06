import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

/**
 * Reproduces the real Ollama report: a prewritten tests/tasks.test.mjs
 * imports non-existent expect from node:test, and createServer returns
 * a plain object rather than an HTTP server.
 *
 * The manifest must pass independently; the server milestone must reject
 * invalid HTTP behavior, and the unrelated future test file must NEVER
 * cause four retries of the manifest milestone.
 */
const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-acceptance-stages-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
const id="acceptance-stages";
const workspace=path.join(root,"projects",id);
fs.mkdirSync(workspace,{recursive:true});
const tools:string[]=[];
let invocations=0;
const deps:SupervisorDeps={
  async think(){throw Error("Known acceptance profile must not ask a model to invent milestone ordering");},
  async runAgent(goal){
    invocations++;
    if(goal.includes("Current milestone (1/3)")){
      fs.writeFileSync(path.join(workspace,"package.json"),JSON.stringify({
        name:"stages-test",type:"module",
        scripts:{test:"node --test",build:"node --check src/server.mjs"}
      }));
      fs.mkdirSync(path.join(workspace,"tests"),{recursive:true});
      fs.writeFileSync(path.join(workspace,"tests","tasks.test.mjs"),
        "import {test,expect} from 'node:test'; test('invalid',()=>expect(1).toBe(1));\n");
    }else if(goal.includes("Current milestone (2/3)")){
      fs.mkdirSync(path.join(workspace,"src"),{recursive:true});
      fs.writeFileSync(path.join(workspace,"src","server.mjs"),
        "export function createServer(){ return {}; }\n");
    }
    return goal.includes("Current milestone (1/3)")
      ?{completed:false,missionId:"staged-agent-"+invocations,
        reason:"Repeated read-only tool blocked: files.read has already succeeded twice with the same arguments and no intervening change."}
      :{completed:true,missionId:"staged-agent-"+invocations};
  },
  async resumeAgent(){throw Error("Unexpected approval resume");},
  async runTool(_projectId,tool,payload){
    tools.push(tool+":"+String(payload.task??""));
    if(tool==="project.run"&&payload.task==="test")throw Error("Tests ran before the test milestone was complete");
    return{ok:true,data:{ok:true,exitCode:0}};
  },
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
const sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:5});
try{
  const job=sup.create("Create a real persistent Node HTTP task app",id,
    {acceptanceProfile:"task-app-http-v1",maxRounds:12});
  const until=Date.now()+15000;
  while(Date.now()<until&&!["failed","completed"].includes(sup.get(job.id)!.status))
    await new Promise(resolve=>setTimeout(resolve,20));
  const result=sup.get(job.id)!;
  assert.equal(result.status,"failed","Fake HTTP server must not pass acceptance");
  assert.deepEqual(result.milestones.map(m=>m.kind),["code","code","code"],
    "Source-file creation, including tests, must use a coding agent that can write files");
  assert.equal(result.milestones[2]?.agent,"coder",
    "The tester agent cannot write tests/tasks.test.mjs: it lacks files.write");
  assert.equal(result.milestones[0]?.status,"done",
    "Valid package.json must pass after an observation-only stop, despite invalid future tests");
  assert.equal(result.milestones[0]?.attempts,1,
    "First milestone must not be retried for a future test error");
  assert.equal(result.milestones[1]?.status,"failed");
  assert.equal(result.milestones[1]?.attempts,4);
  assert.match(result.milestones[1]?.notes??"",/HTTP behavior failed|did not return an HTTP server/,
    "Invalid createServer must be diagnosed during the server phase");
  assert.equal(result.milestones[2]?.status,"pending");
  assert.ok(!tools.some(t=>t==="project.run:test"),
    "Generated tests cannot be run until their milestone");
  assert.ok(tools.some(t=>t==="project.run:build"),"Existing server build is still checked");
  console.log("Acceptance stages: manifest passes, future tests deferred, fake server rejected by real HTTP probe");
}finally{
  sup.stop();
  fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
}
