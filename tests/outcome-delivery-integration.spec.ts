/**
 * Integration acceptance: the actual project.run adapter (not a mocked command)
 * installs, tests, and builds a tiny generated Node application. The planner is
 * deterministic, so CI is not dependent on an external AI provider or account.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";
import {createProjectRunnerAdapter} from "../src/autonomy/project-runner.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-outcome-app-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_ISOLATION_FILE=path.join(root,"isolation.json");
process.env.LAYANX_TRUST_FILE=path.join(root,"trust.json");
const workspace=path.join(root,"outcome-smoke");
fs.mkdirSync(workspace,{recursive:true});

const app=`import http from "node:http";
export function total(items){return items.reduce((sum,item)=>sum+item.price*item.quantity,0);}
export function createApp(){return http.createServer((req,res)=>{
 if(req.url==="/health"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({ok:true}));return;}
 res.writeHead(404);res.end("not found");
});}
`;
const tests=`import test from "node:test";
import assert from "node:assert/strict";
import {total,createApp} from "./app.mjs";
test("invoice total",()=>assert.equal(total([{price:5,quantity:2},{price:2,quantity:3}]),16));
test("real HTTP health endpoint",async()=>{
 const server=createApp();
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const {port}=server.address();
  const response=await fetch("http://127.0.0.1:"+port+"/health");
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true});
 }finally{await new Promise(resolve=>server.close(resolve));}
});
`;
const projectRunner=createProjectRunnerAdapter();
let created=false;
const deps:SupervisorDeps={
  async think(){return JSON.stringify({
    acceptance:["Invoice totals are calculated correctly","The app responds to GET /health"],
    milestones:[{title:"Generate and verify sample app",goal:"Write the application and its behavior tests",kind:"code"}],
    checks:{test:true,build:true,browser:null,security:false,install:true}
  });},
  async runAgent(){
    if(!created){
      fs.writeFileSync(path.join(workspace,"package.json"),JSON.stringify({name:"outcome-smoke",private:true,type:"module",scripts:{test:"node --test test.mjs",build:"node --check app.mjs"}},null,2));
      fs.writeFileSync(path.join(workspace,"app.mjs"),app);
      fs.writeFileSync(path.join(workspace,"test.mjs"),tests);
      created=true;
    }
    return {completed:true,missionId:"integration-app-mission"};
  },
  async resumeAgent(){throw new Error("Unexpected approval for synthetic test agent.");},
  async runTool(projectId,tool,payload){
    if(tool==="project.run"){
      const data=await projectRunner.execute({projectId,missionId:"integration-tool",agentId:"core",
        tool,action:"run project task",permission:"L4_EXECUTE",idempotencyKey:crypto.randomUUID(),payload} as never) as Record<string,unknown>;
      return {ok:data.ok===true,data};
    }
    if(tool==="project.security")return {ok:true,data:{score:100,blocked:false,counts:{}}};
    return {ok:true,data:{ok:true,exitCode:0}};
  },
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
const jobsFile=path.join(root,"supervisor.json");
try{
  const supervisor=new Supervisor(deps,{file:jobsFile,pollMs:20});
  const job=supervisor.create("Create and verify an invoice app with a real HTTP endpoint","outcome-smoke");
  const until=Date.now()+120_000;
  while(!["completed","failed","budget_exhausted"].includes(supervisor.get(job.id)?.status??"")&&Date.now()<until){
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const result=supervisor.get(job.id)!;
  assert.equal(result.status,"completed",JSON.stringify({result:result.result,log:result.log.slice(-12)},null,2));
  assert.equal(result.outcome?.status,"verified");
  assert.ok(result.outcome?.evidence.some(e=>e.reference==="project.run:test"));
  assert.ok(result.outcome?.evidence.some(e=>e.reference==="project.run:build"));
  const evidenceFile=path.join(workspace,".layanx","outcomes",job.id+".json");
  const recorded=JSON.parse(fs.readFileSync(evidenceFile,"utf8")) as {evidence:Array<{reference:string}>};
  assert.match(fs.readFileSync(path.join(workspace,".layanx",".gitignore"),"utf8"),/^outcomes\\/$/m,"private evidence must not be staged by git.add");
  assert.ok(recorded.evidence.some(e=>e.reference==="project.run:test"));
  assert.ok(fs.existsSync(path.join(workspace,"app.mjs")));
  assert.ok(fs.existsSync(path.join(workspace,"test.mjs")));
  const recovered=new Supervisor(deps,{file:jobsFile});
  assert.equal(recovered.get(job.id)?.outcome?.status,"verified","Evidence must survive a restart.");
  console.log("outcome-delivery integration: real npm install/test/build, HTTP request, persisted evidence passed");
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}
