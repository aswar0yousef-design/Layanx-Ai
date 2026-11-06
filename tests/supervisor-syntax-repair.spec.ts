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
let agentCalls=0;
const deps:SupervisorDeps={
 async think(){throw new Error("Acceptance profile uses a fixed milestone plan");},
 async runAgent(goal){
  agentCalls++;
  if(goal.includes("Current milestone (1/3)")){
    fs.writeFileSync(path.join(project,"package.json"),JSON.stringify({
      name:"syntax-gate",type:"module",scripts:{test:"node --test",build:"node --check src/server.mjs"}
    }));
  }else if(goal.includes("Current milestone (2/3)")){
    fs.mkdirSync(path.dirname(serverFile),{recursive:true});
    fs.writeFileSync(serverFile,brokenServer);
  }
  return {completed:true,missionId:"syntax-gate-"+agentCalls};
 },
 async resumeAgent(){throw Error("Unexpected approval");},
 async runTool(_projectId,tool,payload){
  if(tool==="files.write"){
    assert.equal(payload.path,"src/server.mjs","Repair must remain inside the project");
    const content=String(payload.content??"");
    assert.ok(content.length>0,"Repair must write real code");
    fs.writeFileSync(serverFile,content); // mock for audited file adapter
    return{ok:true,data:{path:"src/server.mjs",bytes:Buffer.byteLength(content),written:true}};
  }
  if(tool==="project.run"&&payload.task==="build"){
    const result=spawnSync(process.execPath,["--check","src/server.mjs"],
      {cwd:project,encoding:"utf8",timeout:4000,windowsHide:true});
    return{ok:result.status===0,data:{ok:result.status===0,exitCode:result.status,
      stdout:result.stdout??"",stderr:result.stderr??""}};
  }
  return{ok:true,data:{ok:true,exitCode:0}};
 },
 isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
let sup:Supervisor|undefined;
try{
 sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:5});
 const job=sup.create("Create a persistent Node HTTP task app",id,
   {acceptanceProfile:"task-app-http-v1",maxRounds:12});
 const deadline=Date.now()+15000;
 while(!["failed","completed"].includes(sup.get(job.id)!.status)&&Date.now()<deadline)
   await new Promise(resolve=>setTimeout(resolve,25));
 const state=sup.get(job.id)!;
 assert.equal(state.milestones[0]?.status,"done","Real package.json must pass first");
 assert.equal(state.milestones[1]?.status,"done","Real HTTP server must pass after syntax repair");
 assert.equal(state.milestones[1]?.attempts,1,"A repairable syntax error must not waste multiple model attempts");
 assert.equal(state.milestones[2]?.status,"failed","Missing generated test file cannot pass final acceptance");
 assert.equal(agentCalls,6,"Manifest and server once each, then four tries for missing test source");
 assert.ok(state.log.some(log=>log.msg.includes("Repaired broken multiline HTML literal")));
 assert.equal(spawnSync(process.execPath,["--check",serverFile],{encoding:"utf8"}).status,0);
 assert.ok(fs.readFileSync(serverFile,"utf8").includes("node:http"));
 console.log("Supervisor: real HTTP app syntax repaired, ten endpoint/restart probes passed at the server stage");
}finally{
 if(sup)sup.stop();
 fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
}
