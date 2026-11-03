import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {verifyTaskAppUI} from "../src/autonomy/task-app-ui-verifier.js";
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-ui-acceptance-"));
fs.mkdirSync(path.join(workspace,"src"),{recursive:true});
const serverFile=path.join(workspace,"src","server.mjs");
const app="import http from \"node:http\";\nlet tasks=[];\nconst html=\"<!doctype html><html lang=\\\"ar\\\"><head><meta name=\\\"viewport\\\" content=\\\"width=device-width\\\"></head><body><h1>المهام Tasks</h1><input data-testid=\\\"task-input\\\"><button data-testid=\\\"task-add\\\">Add إضافة</button><div id=\\\"tasks\\\"></div><script>\\nasync function refresh(){const data=await (await fetch('/tasks')).json();const list=document.getElementById('tasks');list.replaceChildren();for(const t of data.tasks){const item=document.createElement('div');item.dataset.testid='task-item';item.textContent=t.title;const btn=document.createElement('button');btn.dataset.testid='task-delete';btn.textContent='Remove';btn.onclick=async()=>{await fetch('/tasks/'+t.id,{method:'DELETE'});await refresh();};item.append(btn);list.append(item);}}\\ndocument.querySelector('[data-testid=task-add]').onclick=async()=>{const title=document.querySelector('[data-testid=task-input]').value;await fetch('/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title})});await refresh();};refresh();\\n</script></body></html>\";\nexport function createServer(){return http.createServer(async(req,res)=>{\nconst send=(body,status=200,type=\"application/json\")=>{res.writeHead(status,{\"content-type\":type});res.end(typeof body===\"string\"?body:JSON.stringify(body));};\nif(req.url===\"/\"&&req.method===\"GET\")return send(html,200,\"text/html\");\nif(req.url===\"/tasks\"&&req.method===\"GET\")return send({tasks});\nif(req.url===\"/tasks\"&&req.method===\"POST\"){let text=\"\";for await(const chunk of req)text+=chunk;const title=JSON.parse(text).title;const task={id:String(Date.now()+Math.random()),title};tasks.push(task);return send(task,201);}\nif(req.url?.startsWith(\"/tasks/\")&&req.method===\"DELETE\"){tasks=tasks.filter(t=>t.id!==decodeURIComponent(req.url.slice(7)));return send({ok:true});}\nsend({ok:false},404);});}";
try{
 fs.writeFileSync(serverFile,app);
 const good=await verifyTaskAppUI(workspace);
 if(!good.ok&&good.blockers.some(b=>/No Edge or Chrome|playwright-core/i.test(b))){
   assert.equal(good.ok,false);
   console.log("task-app-ui-verifier: browser unavailable; correctly failed closed; browser success not claimed");
 }else{
   assert.equal(good.ok,true,JSON.stringify(good));
   assert.equal(good.checks.length,9);
   fs.writeFileSync(serverFile,app.replace('data-testid=\\"task-add\\"','data-testid=\\"broken-add\\"').replace('data-testid="task-add"','data-testid="broken-add"'));
   const failed=await verifyTaskAppUI(workspace);
   assert.equal(failed.ok,false,"Broken add button must be detected");
   assert.ok(failed.blockers.some(x=>/desktop-create/.test(x)),JSON.stringify(failed));
   console.log("task-app-ui-verifier: desktop/mobile UI clicks and reload passed; broken control rejected");
 }
}finally{fs.rmSync(workspace,{recursive:true,force:true});}
process.exit(0);
