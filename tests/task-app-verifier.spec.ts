import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {composeTaskTestSource,TASK_SERVER_SKELETON,taskTestContractViolations,verifyTaskApp} from "../src/autonomy/task-app-verifier.js";

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
  assert.equal(pass.checks.length,11);
  assert.ok(pass.checks.every(c=>c.ok));
  // Real failure: rows built with browser DOM calls on the server; home only crashed once a task existed.
  const domOnServer=path.join(root,"dom-on-server");
  fs.mkdirSync(path.join(domOnServer,"src"),{recursive:true});
  fs.writeFileSync(path.join(domOnServer,"src","server.mjs"),server.replace(
    'res.writeHead(200,{"content-type":"text/html; charset=utf-8"});',
    'const rows=tasks.map(()=>document.createElement("tr"));res.writeHead(200,{"content-type":"text/html; charset=utf-8"});'));
  const crashed=await verifyTaskApp(domOnServer);
  assert.equal(crashed.ok,false,"A home page that kills the server once tasks exist must never pass");
  assert.ok(crashed.blockers.some(b=>b.startsWith("home-with-task")&&b.includes("document is not defined")),JSON.stringify(crashed));
  // Real failure: shared cwd tasks.json, static server import, and no finally, so a failed assertion hung the run.
  const pollutingSuite=`
import assert from 'node:assert/strict';
const { test } = await import('node:test');
import { createServer } from '../src/server.mjs';
test('delete', async () => {
  const server = await createServer();
  server.listen(0, '127.0.0.1');
  await fetch('http://127.0.0.1/health');
  await fetch('http://127.0.0.1/tasks', { method: 'POST' });
  await fetch('http://127.0.0.1/tasks/1', { method: 'DELETE' });
  server.close();
});`;
  const violations=taskTestContractViolations(pollutingSuite).join(" ");
  assert.match(violations,/statically/);
  assert.match(violations,/tasks\.json/);
  assert.match(violations,/finally/);
  assert.match(taskTestContractViolations("await import('../src/server.mjs');process.env.LAYANX_TASKS_FILE='x';").join(" "),/before await import/);
  const compliant=`process.env.LAYANX_TASKS_FILE=f;const {createServer}=await import('../src/server.mjs');
try{fetch('/health');fetch(u,{method:'POST'});fetch(u,{method:'DELETE'});}finally{s.close();}`;
  assert.deepEqual(taskTestContractViolations(compliant),[]);
  assert.match(taskTestContractViolations(compliant+"const fs=require('fs');").join(" "),/require/);
  // Assertion-only replies run inside the fixed harness; a failed assertion must exit, never hang.
  const statements=`import fs from "node:fs";
let url = await open();
assert.deepEqual(await (await fetch(url+"/health")).json(),{ok:true});
const made=await (await fetch(url+"/tasks",{method:"POST",body:JSON.stringify({title:"a"})})).json();
await close();url=await open();
assert.equal((await fetch(url+"/tasks/"+made.id,{method:"DELETE"})).status,200);`;
  const composed=composeTaskTestSource(statements);
  assert.deepEqual(taskTestContractViolations(composed),[],composed);
  const runSuite=(source:string)=>{
    fs.mkdirSync(path.join(app,"tests"),{recursive:true});
    fs.writeFileSync(path.join(app,"tests","tasks.test.mjs"),source);
    return spawnSync(process.execPath,["--test"],{cwd:app,encoding:"utf8",timeout:20000,windowsHide:true});
  };
  const passing=runSuite(composed);
  assert.equal(passing.status,0,passing.stdout+passing.stderr);
  const failing=runSuite(composeTaskTestSource(statements+'\nassert.equal("a","b");'));
  assert.equal(failing.status,1,"A failed assertion must end the run rather than time out");
  fs.rmSync(path.join(app,"tests"),{recursive:true,force:true});
  const wholeFile="import {test} from 'node:test';\ntest('x',()=>{});";
  assert.equal(composeTaskTestSource(wholeFile),wholeFile,"A whole file is left for the contract gate");
  assert.ok(taskTestContractViolations(composeTaskTestSource(wholeFile)).length>0);
  // Real failure: the model echoed the harness without its imports (mkdtemp is not defined).
  const echoedHarness="import {test} from 'node:test'; test('task api',async()=>{ const dir=await mkdtemp(join(tmpdir(),'t')); try { let url = await open(); "+statements.split("\n").slice(2).join(" ")+" } finally { await close(); } });";
  const recovered=composeTaskTestSource(echoedHarness);
  assert.equal((recovered.match(/from 'node:test'/g)??[]).length,1);
  assert.ok(recovered.includes("import {mkdtemp,rm} from 'node:fs/promises';"));
  assert.equal(runSuite(recovered).status,0,recovered);
  fs.rmSync(path.join(app,"tests"),{recursive:true,force:true});
  // A double quote would end the JSON string the model returns the file in.
  assert.ok(!TASK_SERVER_SKELETON.includes('"'),"Skeleton must contain no double quote");
  // The structure given to the model must be valid, and complete once its two slots are filled.
  assert.equal(spawnSync(process.execPath,["--check","--input-type=module"],{input:TASK_SERVER_SKELETON,encoding:"utf8",windowsHide:true}).status,0,"Skeleton must be valid JavaScript");
  const filled=path.join(root,"skeleton-filled");
  fs.mkdirSync(path.join(filled,"src"),{recursive:true});
  fs.writeFileSync(path.join(filled,"src","server.mjs"),TASK_SERVER_SKELETON
    .replace("// BROWSER CODE GOES HERE","document.title='x';\nfetch('/tasks');")
    .replace("// ROUTES GO HERE, one if statement per route ending in return",[
      "if(req.method==='GET'&&route==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(page);}",
      "if(req.method==='GET'&&route==='/tasks')return json(res,200,{tasks:loadTasks()});",
      "if(req.method==='POST'&&route==='/tasks'){const tasks=loadTasks();const task={id:String(Date.now()),title:JSON.parse(await readBody(req)).title};tasks.push(task);saveTasks(tasks);return json(res,201,task);}",
      "if(req.method==='DELETE'&&route.startsWith('/tasks/')){const id=decodeURIComponent(route.slice(7));saveTasks(loadTasks().filter(t=>String(t.id)!==id));return json(res,200,{deleted:true});}"
    ].join("\n")));
  const skeletonApp=await verifyTaskApp(filled);
  assert.equal(skeletonApp.ok,true,JSON.stringify(skeletonApp));
  fs.writeFileSync(path.join(broken,"src","server.mjs"),server.replaceAll("save();","/* intentionally does not persist */"));
  const fail=await verifyTaskApp(broken);
  assert.equal(fail.ok,false,"A volatile task list must never pass restart verification");
  assert.ok(fail.blockers.some(b=>b.includes("persistent-create")),JSON.stringify(fail));
  console.log("task-app-verifier: real HTTP create/list/delete and restart persistence tested");
}finally{fs.rmSync(root,{recursive:true,force:true});}
