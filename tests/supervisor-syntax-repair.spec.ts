import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";
import {coreSupervisorDeps} from "../src/autonomy/runtime-deps.js";
import type {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelRequest} from "../src/models/inference.js";
import {securityReport} from "../src/autonomy/security-scan.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-syntax-gate-"));
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
process.env.LAYANX_STORE_DIR=path.join(root,"store");
const id="syntax-gate";
const project=path.join(process.env.LAYANX_WORKSPACE_ROOT,id);
fs.mkdirSync(project,{recursive:true});
const serverFile=path.join(project,"src","server.mjs");
const validServer=String.raw`
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const storage=process.env.LAYANX_TASKS_FILE;
let tasks=fs.existsSync(storage)?JSON.parse(fs.readFileSync(storage,"utf8")):[];
function save(){fs.mkdirSync(path.dirname(storage),{recursive:true});fs.writeFileSync(storage,JSON.stringify(tasks));}
export function createServer(){
  return http.createServer(async(req,res)=>{
    const u=new URL(req.url,"http://localhost");
    function json(value,status=200){res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(value));}
    if(req.method==="GET"&&u.pathname==="/health")return json({ok:true});
    if(req.method==="GET"&&u.pathname==="/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      return res.end("<html><body><h1>Tasks / المهام</h1><button>Add / إضافة</button><button>Delete / حذف</button></body></html>");
    }
    if(req.method==="GET"&&u.pathname==="/tasks")return json({tasks});
    if(req.method==="POST"&&u.pathname==="/tasks"){
      let body="";for await(const chunk of req)body+=chunk.toString();
      const title=JSON.parse(body).title;
      const task={id:String(Date.now()),title};tasks.push(task);save();return json(task,201);
    }
    if(req.method==="DELETE"&&u.pathname.startsWith("/tasks/")){
      const id=decodeURIComponent(u.pathname.slice("/tasks/".length));
      tasks=tasks.filter(task=>String(task.id)!==id);save();return json({deleted:true});
    }
    return json({error:"not found"},404);
  });
}
`;
const brokenServer=validServer.replace("return res.end(\"<html><body><h1>Tasks / المهام</h1><button>Add / إضافة</button><button>Delete / حذف</button></body></html>\");","return res.end('<html>\n<body><h1>Tasks / المهام</h1><button>Add / إضافة</button><button>Delete / حذف</button></body>\n</html>');");
assert.notEqual(brokenServer,validServer,"Fixture must create a syntax error");
const hangingServer=`
import http from "node:http";
export function createServer(){
  return http.createServer((req,res)=>{
    if(req.url==="/health")res.end(JSON.stringify({ok:true}));
    // The generated home handler never sent a response.
  });
}
`;
const duplicateBinding="import {createServer} from 'node:http';\nexport function createServer(){}";
let agentCalls=0;
let serverGenerations=0;
let testGenerations=0;
let verifiedSource="";
const runtimeDeps=coreSupervisorDeps({
 modelExecution:{async execute(request:ModelRequest){
  assert.equal(request.capability,"coding");
  assert.equal(request.maxOutputTokens,3000);
  assert.ok(request.responseSchema);
  const prompt=String(request.input);
  assert.match(prompt,/src\/server\.mjs/);
  if(prompt.includes("Verified server source for reference only:")){
    testGenerations++;
    assert.ok(prompt.includes(verifiedSource));
    if(testGenerations===2)assert.match(prompt,/Test contract violation/);
    if(testGenerations===3)assert.match(prompt,/deliberate-failure/);
    const compliantTest=(assertion:string)=>`
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
test("real HTTP tasks",{timeout:4000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),"tasks-"));
  process.env.LAYANX_TASKS_FILE=join(dir,"tasks.json");
  const {createServer}=await import("../src/server.mjs");
  const server=createServer();
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const url="http://127.0.0.1:"+server.address().port;
    assert.deepEqual(await (await fetch(url+"/health")).json(),{ok:true});
    const created=await (await fetch(url+"/tasks",{method:"POST",body:JSON.stringify({title:"a"})})).json();
    assert.equal((await fetch(url+"/tasks/"+created.id,{method:"DELETE"})).status,200);
    ${assertion}
  }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});}
});`;
    const content=[
      "import {test} from 'node:test';\ncreateServer();",
      compliantTest('assert.equal("deliberate-failure","expected-value");'),
      compliantTest("")
    ][testGenerations-1]!;
    return {output:JSON.stringify({content}),modelId:"test-coder"};
  }
  throw new Error("Only the task tests go through the model mock");
 }}
} as unknown as LayanXCore);
const deps:SupervisorDeps={
 async think(){throw new Error("Acceptance profile uses a fixed milestone plan");},
 async runAgent(goal){
  agentCalls++;
  if(goal.includes("Current milestone (1/3)")){
    fs.writeFileSync(path.join(project,"package.json"),JSON.stringify({
      name:"syntax-gate",type:"module",scripts:{test:"node --test",build:"node --check src/server.mjs"}
    }));
  }else throw Error("Only the manifest may use the adaptive agent");
  return {completed:true,missionId:"syntax-gate-"+agentCalls};
 },
 // Whole files on purpose: this spec is about the repair path, and a composed file could not carry these defects.
 async generateTaskServer(goal,previous){
  serverGenerations++;
  if(serverGenerations===2){
    assert.match(goal,/Previous failure: HTTP behavior failed:\s+bilingual-home.*timeout/i);
    assert.ok(previous.includes(hangingServer.trim().slice(0,40)));
  }
  if(serverGenerations===3){
    assert.match(goal,/Identifier 'createServer' has already been declared/);
    assert.equal(previous,"");
  }
  return{content:[hangingServer,duplicateBinding,brokenServer][serverGenerations-1]!,modelId:"test-coder"};
 },
 generateTaskTests:runtimeDeps.generateTaskTests,
 async resumeAgent(){throw Error("Unexpected approval");},
 async runTool(_projectId,tool,payload){
  if(tool==="project.security"){
    const data=await securityReport(project,{audit:false,external:false});
    return{ok:true,data};
  }
  if(tool==="files.write"){
    assert.ok(payload.path==="src/server.mjs"||payload.path==="tests/tasks.test.mjs");
    const file=path.join(project,String(payload.path));
    const content=String(payload.content??"");
    assert.ok(content.length>0,"Repair must write real code");
    if(file===serverFile){assert.equal(testGenerations,0);verifiedSource=content;}
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,content); // mock for audited file adapter
    return{ok:true,data:{path:"src/server.mjs",bytes:Buffer.byteLength(content),written:true}};
  }
  if(tool==="project.run"&&payload.task==="build"){
    const result=spawnSync(process.execPath,["--check","src/server.mjs"],
      {cwd:project,encoding:"utf8",timeout:4000,windowsHide:true});
    return{ok:result.status===0,data:{ok:result.status===0,exitCode:result.status,
      stdout:result.stdout??"",stderr:result.stderr??""}};
  }
  if(tool==="project.run"&&payload.task==="test"){
    const result=spawnSync(process.execPath,["--test"],{
      cwd:project,encoding:"utf8",timeout:5000,windowsHide:true,
      env:{...process.env,LAYANX_TASKS_FILE:path.join(project,"test-tasks.json")}
    });
    return{ok:result.status===0,data:{ok:result.status===0,exitCode:result.status,stdout:result.stdout??"",stderr:result.stderr??""}};
  }
  return{ok:true,data:{ok:true,exitCode:0}};
 },
 isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
let sup:Supervisor|undefined;
try{
 sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:5});
 const job=sup.create("Create a persistent Node HTTP task app",id,
   {acceptanceProfile:"task-app-http-v1",maxRounds:12,requiredAcceptance:[
    {id:"task-tests",description:"Generated tests pass",required:true,checkId:"test",artifact:"tests/tasks.test.mjs"},
    {id:"server-build",description:"Server builds",required:true,checkId:"build",artifact:"src/server.mjs"},
    {id:"task-behavior",description:"Independent HTTP and restart",required:true,checkId:"independent:task-app-http-v1",artifact:"src/server.mjs"}
   ]});
 const deadline=Date.now()+25000;
 while(!["failed","completed"].includes(sup.get(job.id)!.status)&&Date.now()<deadline)
   await new Promise(resolve=>setTimeout(resolve,25));
 const state=sup.get(job.id)!;
 assert.equal(state.milestones[0]?.status,"done","Real package.json must pass first");
 assert.equal(state.milestones[1]?.status,"done",state.milestones[1]?.notes??"Real HTTP server must pass after syntax repair");
 assert.equal(state.milestones[1]?.attempts,3,"The HTTP and duplicate binding failures require retries, and the narrow HTML repair needs no additional model call");
 assert.equal(state.status,"completed",state.result??JSON.stringify(state.log.slice(-8)));
 assert.equal(state.milestones[2]?.status,"done");
 assert.equal(testGenerations,3);
 assert.equal(agentCalls,1);
 assert.equal(fs.readFileSync(serverFile,"utf8"),verifiedSource);
 assert.equal(state.outcome?.status,"verified");
 assert.equal(state.outcome?.evidence.filter(e=>e.name.startsWith("acceptance:")&&e.passed).length,3);
 assert.ok(fs.existsSync(path.join(project,".layanx","deliveries",job.id+".json")));
 assert.equal(serverGenerations,3);
 assert.equal(state.behavior?.checks.length,11);
 assert.ok(state.log.some(log=>log.msg.includes("Repaired broken multiline HTML literal")));
 assert.equal(spawnSync(process.execPath,["--check",serverFile],{encoding:"utf8"}).status,0);
 assert.ok(fs.readFileSync(serverFile,"utf8").includes("node:http"));
 console.log("Supervisor: real HTTP app repaired, generated test retried, verified server preserved, and delivery accepted");
}finally{
 if(sup)sup.stop();
 fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
}
