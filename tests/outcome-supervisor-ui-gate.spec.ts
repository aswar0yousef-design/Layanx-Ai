import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

// The generated API below has valid persistent HTTP behavior, but inert UI buttons.
// A mocked agent's success and mocked project tests cannot certify the broken UI.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-ui-supervisor-gate-"));
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
process.env.LAYANX_STORE_DIR=path.join(root,"store");
const project="task-app-ui-gate",dir=path.join(process.env.LAYANX_WORKSPACE_ROOT,project);
fs.mkdirSync(path.join(dir,"src"),{recursive:true});
fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name:"ui-gate",type:"module",scripts:{test:"node --test",build:"node --check src/server.mjs"}}));
const server=String.raw`
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
fs.writeFileSync(path.join(dir,"src","server.mjs"),server);
const deps:SupervisorDeps={
 async think(){return JSON.stringify({acceptance:["A working task app"],milestones:[{title:"Create",goal:"Create app",kind:"code"}],checks:{test:true,build:true,security:false,browser:null}});},
 async runAgent(){return{completed:true,missionId:"agent-claimed-done"};},
 async resumeAgent(){throw Error("Unexpected approval");},
 async runTool(_project,tool){if(tool==="project.security")return{ok:true,data:{score:100,blocked:false,counts:{}}};return{ok:true,data:{ok:true,exitCode:0}};},
 isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null
};
try{
 const sup=new Supervisor(deps,{file:path.join(root,"jobs.json"),pollMs:5});
 const job=sup.create("Create a task API with verified interactive controls",project,{acceptanceProfile:"task-app-ui-v1",maxRounds:15});
 const deadline=Date.now()+70000;
 while(!["failed","completed","budget_exhausted"].includes(sup.get(job.id)?.status??"")&&Date.now()<deadline)
   await new Promise(resolve=>setTimeout(resolve,50));
 const final=sup.get(job.id)!;
 assert.equal(final.status,"failed","Inert UI must never become completed even if HTTP works");
 assert.equal(final.behavior?.ok,true,"HTTP API is genuinely functional");
 assert.equal(final.uiBehavior?.ok,false,"Independent real browser could not operate UI");
 assert.equal(final.outcome?.status,"blocked");
 assert.ok(final.outcome?.evidence.some(e=>e.reference==="independent:ui:task-app"&&!e.passed));
 assert.ok(final.finalRepairs<=2);
 const recovered=new Supervisor(deps,{file:path.join(root,"jobs.json")});
 assert.equal(recovered.get(job.id)?.uiBehavior?.ok,false,"Failed browser verification must survive restart");
 recovered.stop();sup.stop();
 console.log("Supervisor UI gate: API passed but missing interactive controls blocked delivery");
}finally{fs.rmSync(root,{recursive:true,force:true});}
process.exit(0);
