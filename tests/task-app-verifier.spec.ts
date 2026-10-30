import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {verifyTaskApp} from "../src/autonomy/task-app-verifier.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-independent-acceptance-"));
const app=path.join(root,"working");
const broken=path.join(root,"no-persistence");
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
try{
  for(const dir of [app,broken])fs.mkdirSync(path.join(dir,"src"),{recursive:true});
  fs.writeFileSync(path.join(app,"src","server.mjs"),server);
  const pass=await verifyTaskApp(app);
  assert.equal(pass.ok,true,JSON.stringify(pass));
  assert.equal(pass.checks.length,10);
  assert.ok(pass.checks.every(c=>c.ok));
  fs.writeFileSync(path.join(broken,"src","server.mjs"),server.replaceAll("save();","/* intentionally does not persist */"));
  const fail=await verifyTaskApp(broken);
  assert.equal(fail.ok,false,"A volatile task list must never pass restart verification");
  assert.ok(fail.blockers.some(b=>b.includes("persistent-create")),JSON.stringify(fail));
  console.log("task-app-verifier: real HTTP create/list/delete and restart persistence tested");
}finally{fs.rmSync(root,{recursive:true,force:true});}
