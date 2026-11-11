/**
 * Independent, real-HTTP acceptance probe for a generated task app.
 * Never trusts the agent's own tests or "done" message as behavioral proof.
 * Executes generated code only in a child process inside a disposable project.
 * WARNING: this is process isolation, NOT an OS sandbox.
 */
import fs from "node:fs";
import path from "node:path";
import {spawn,type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";

export const taskServerGoal="Write a complete src/server.mjs exporting function createServer() that returns a real Node HTTP server. GET /health returns {ok:true}. GET / serves a bilingual Arabic/English task UI with working add and per-task delete controls. POST /tasks accepts {title} and returns {id,title}; GET /tasks returns {tasks:[...]}; DELETE /tasks/:id deletes that task. Persist additions and deletions across restarts at process.env.LAYANX_TASKS_FILE. Use built-in Node modules and no external dependencies. Write only src/server.mjs.";

/**
 * Structure handed to the coding model for src/server.mjs. Small local models
 * kept breaking the same spots when left to choose: backticks nested in an HTML
 * template, an unclosed createServer call, and a double-wrapped storage shape.
 * Everything specific to the app (routes and browser code) is still generated.
 * It deliberately contains no double quote: the model returns the file inside a
 * JSON string, and an unescaped double quote cuts the file off at that point.
 */
export const TASK_SERVER_SKELETON=[
  "import http from 'node:http';",
  "import fs from 'node:fs';",
  "const file=process.env.LAYANX_TASKS_FILE||'tasks.json';",
  "function loadTasks(){try{return JSON.parse(fs.readFileSync(file,'utf8')).tasks||[];}catch{return [];}}",
  "function saveTasks(tasks){fs.writeFileSync(file,JSON.stringify({tasks}));}",
  "function readBody(req){return new Promise(resolve=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>resolve(body));});}",
  "function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}",
  "const page=`<!doctype html><html><head><meta charset=utf-8><title>Tasks / المهام</title></head><body>",
  "<h1>Tasks / المهام</h1>",
  "<input id=title><button id=add>Add / إضافة</button><ul id=list></ul>",
  "<script>",
  "// BROWSER CODE GOES HERE",
  "</script></body></html>`;",
  "export function createServer(){",
  "  return http.createServer(async(req,res)=>{",
  "    const route=req.url.split('?')[0];",
  "    if(req.method==='GET'&&route==='/health')return json(res,200,{ok:true});",
  "    // ROUTES GO HERE, one if statement per route ending in return",
  "    return json(res,404,{error:'not found'});",
  "  });",
  "}"
].join("\n");

const ROUTES_START="    // ROUTES START",ROUTES_END="    // ROUTES END";
const TASK_PAGE_OPEN="<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Tasks / المهام</title></head><body><h1>Tasks / المهام</h1><input id=title><button id=add>Add / إضافة</button><ul id=list></ul><script>\n";
const TASK_PAGE_CLOSE="\n</script></body></html>";
const compiles=(code:string,label:string)=>{
  const AsyncFunction=(async()=>undefined).constructor as FunctionConstructor;
  try{new AsyncFunction("req","res","route",code);}catch(error){throw new Error(`Unusable output: the ${label} code does not parse: ${(error as Error).message}`);}
};
/**
 * Node code and browser code never share a string. Models kept breaking the quoting when one was nested in the other, and
 * browser code leaked into Node where it crashed on `document`. They now come back apart and the page is escaped here.
 */
export function composeTaskServer(routes:string,browser:string):string{
  const node=routes.trim(),script=browser.trim().replace(/<\/?script[^>]*>/gi,"").trim();
  if(!node||!script)throw new Error("Unusable output: routes or browser code is empty.");
  if(/\b(?:document|window|localStorage)\s*[.[]/.test(node))throw new Error("Unusable output: routes run in Node and must not use document, window or localStorage.");
  compiles(node,"routes");compiles(script,"browser");
  return TASK_SERVER_SKELETON
    .replace(/const page=`[\s\S]*?<\/html>`;/,()=>"const page="+JSON.stringify(TASK_PAGE_OPEN+script+TASK_PAGE_CLOSE)+";")
    .replace("    // ROUTES GO HERE, one if statement per route ending in return",()=>ROUTES_START+"\n"+node+"\n"+ROUTES_END)+"\n";
}
/** The two parts back out of a composed file, so a repair works on what the model wrote. */
export function decomposeTaskServer(source:string):{routes:string;browser:string}|undefined{
  const routes=source.split(ROUTES_START+"\n")[1]?.split("\n"+ROUTES_END)[0];
  const page=/^const page=(".*");$/m.exec(source)?.[1];
  if(routes===undefined||!page)return undefined;
  try{const html=JSON.parse(page) as string;return{routes,browser:html.slice(TASK_PAGE_OPEN.length,html.length-TASK_PAGE_CLOSE.length)};}catch{return undefined;}
}

const TASK_TEST_HARNESS_HEAD=[
  "import {test} from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import {mkdtemp,rm} from 'node:fs/promises';",
  "import {tmpdir} from 'node:os';",
  "import {join} from 'node:path';",
  "test('task api',{timeout:30000},async()=>{",
  "  const dir=await mkdtemp(join(tmpdir(),'tasks-'));",
  "  process.env.LAYANX_TASKS_FILE=join(dir,'tasks.json');",
  "  const {createServer}=await import('../src/server.mjs');",
  "  let server;",
  "  const open=async()=>{server=await createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;};",
  "  const close=()=>new Promise(r=>{if(!server?.listening)return r();server.close(r);server.closeAllConnections();});",
  "  try{",
  "    let url=await open();"
].join("\n");
const TASK_TEST_HARNESS_TAIL=[
  "  }finally{await close();await rm(dir,{recursive:true,force:true});}",
  "});"
].join("\n");

/** The fixed harness, shown to the model so it knows what its statements run inside. */
export const TASK_TEST_HARNESS=TASK_TEST_HARNESS_HEAD+"\n    // YOUR STATEMENTS RUN HERE\n"+TASK_TEST_HARNESS_TAIL;

/**
 * Wraps model-written assertion statements in the fixed harness. A reply that
 * is a whole test file anyway is returned as is, for the contract gate to judge.
 */
export function composeTaskTestSource(content:string):string{
  // Models sometimes echo the whole harness, often dropping its imports: keep only their statements.
  const echoed=/let\s+url\s*=\s*await\s+open\(\)\s*;?([\s\S]*?)\}\s*finally\b/.exec(content)?.[1];
  if(echoed===undefined&&/from\s*["']node:test["']|import\(\s*["']node:test["']\s*\)/.test(content))return content;
  const statements=(echoed??content)
    .replace(/^\s*import\s.*$/gm,"")
    .replace(/^\s*(?:let|const|var)\s+url\s*=\s*await\s+open\(\)\s*;?\s*$/m,"")
    .trim();
  return TASK_TEST_HARNESS_HEAD+"\n"+statements+"\n"+TASK_TEST_HARNESS_TAIL+"\n";
}

/**
 * Cheap static gate for a generated tests/tasks.test.mjs, applied before it is
 * ever executed. Each rule maps to a way a generated suite produced a false
 * failure or hung the run: shared storage between tests, importing the server
 * before its storage path is set, and servers left listening after an assertion.
 */
export function taskTestContractViolations(source:string):string[]{
  const violations:string[]=[];
  const setsStorage=source.search(/process\.env\.LAYANX_TASKS_FILE\s*=(?!=)/);
  const loadsServer=source.search(/import\(\s*["'`]\.\.\/src\/server\.mjs["'`]\s*\)/);
  if(/^\s*import\s[^;]*?from\s*["'][^"']*server\.mjs["']/m.test(source))
    violations.push("Do not import ../src/server.mjs statically: it reads its storage path when loaded, before the test can set it.");
  if(setsStorage<0)
    violations.push("Assign process.env.LAYANX_TASKS_FILE to a new temporary file, or the tests share and pollute the project's tasks.json.");
  if(loadsServer<0)
    violations.push("Load the server with await import('../src/server.mjs').");
  else if(setsStorage>loadsServer)
    violations.push("Assign process.env.LAYANX_TASKS_FILE before await import('../src/server.mjs').");
  if(/\brequire\s*\(/.test(source))
    violations.push("Do not call require(): this is an ES module, and fs, path and assert are imported or not needed.");
  if(!/\bfinally\b/.test(source)||!/\.close\(/.test(source))
    violations.push("Close every server inside a finally block, or a failed assertion leaves it listening and the test process never exits.");
  for(const [pattern,label] of [[/["'`]POST["'`]/,"POST /tasks"],[/["'`]DELETE["'`]/,"DELETE /tasks/:id"],[/\/health/,"GET /health"]] as const)
    if(!pattern.test(source))violations.push("Exercise "+label+" over real HTTP.");
  return violations;
}

export interface TaskAppProbeCheck {name:string;ok:boolean;detail:string}
export interface TaskAppProbeResult {
  ok:boolean;
  checks:TaskAppProbeCheck[];
  blockers:string[];
  verificationScope:"real-http-and-restart";
}

const launcher=[
  'import {pathToFileURL} from "node:url";',
  'const mod=await import(pathToFileURL(process.argv[1]).href);',
  'if(typeof mod.createServer!=="function") throw Error("createServer export is missing");',
  'const server=await mod.createServer();',
  'if(!server||typeof server.listen!=="function") throw Error("createServer did not return an HTTP server");',
  'server.listen(0,"127.0.0.1",()=>console.log("LAYANX_ACCEPTANCE_PORT="+server.address().port));',
  'process.on("SIGTERM",()=>server.close(()=>process.exit(0)));'
].join("\n");

async function startServer(serverFile:string,workspace:string,storageFile:string):Promise<{child:ChildProcess;url:string;stderr:()=>string}>{
  const env:NodeJS.ProcessEnv={
    PATH:process.env.PATH??process.env.Path??"",
    SystemRoot:process.env.SystemRoot,
    TEMP:process.env.TEMP,
    TMP:process.env.TMP,
    HOME:process.env.HOME,
    USERPROFILE:process.env.USERPROFILE,
    NODE_ENV:"test",
    LAYANX_TASKS_FILE:storageFile
  };
  const child=spawn(process.execPath,["--input-type=module","-e",launcher,serverFile],{
    cwd:workspace,env,stdio:["ignore","pipe","pipe"],windowsHide:true
  });
  return await new Promise((resolve,reject)=>{
    let done=false,output="",errors="";
    const timer=setTimeout(()=>finish(new Error("Server startup timed out: "+errors.slice(-500))),10000);
    const finish=(error?:Error,url?:string)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners("data");
      child.removeListener("error",onError);
      child.removeListener("exit",onExit);
      if(error){child.kill();reject(error);}
      else resolve({child,url:url!,stderr:()=>errors.trim()});
    };
    const onError=(e:Error)=>finish(e);
    const onExit=(code:number|null)=>finish(new Error("Server exited ("+code+"): "+errors.slice(-500)));
    child.on("error",onError);
    child.on("exit",onExit);
    child.stdout?.on("data",(chunk:Buffer)=>{
      output=(output+chunk.toString()).slice(-4000);
      const match=/LAYANX_ACCEPTANCE_PORT=(\d+)/.exec(output);
      if(match){
        const port=Number(match[1]);
        if(Number.isInteger(port)&&port>0&&port<=65535)finish(undefined,"http://127.0.0.1:"+port);
      }
    });
    child.stderr?.on("data",(chunk:Buffer)=>{errors=(errors+chunk.toString()).slice(-2000);});
  });
}
async function stopServer(child:ChildProcess|undefined){
  if(!child||child.exitCode!==null||child.killed)return;
  const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
  child.kill();
  await Promise.race([exited,new Promise<void>(resolve=>setTimeout(resolve,1500))]);
  if(child.exitCode===null)child.kill("SIGKILL");
}
async function request(url:string,route:string,init?:RequestInit){
  const response=await fetch(url+route,{...init,signal:AbortSignal.timeout(5000)});
  return response;
}
async function parseTasks(response:Response):Promise<Array<Record<string,unknown>>>{
  if(!response.ok)throw Error("GET /tasks HTTP "+response.status);
  const body:unknown=await response.json();
  const tasks=Array.isArray(body)?body:
    typeof body==="object"&&body!==null&&Array.isArray((body as {tasks?:unknown}).tasks)?
      (body as {tasks:Array<unknown>}).tasks:null;
  if(!tasks||!tasks.every(t=>t!==null&&typeof t==="object"&&!Array.isArray(t)))
    throw Error("GET /tasks must return a task array or {tasks:[...]}");
  return tasks as Array<Record<string,unknown>>;
}

/** Probes health, bilingual HTML, add/list, persistence after restart, delete and durable deletion. */
export async function verifyTaskApp(workspace:string):Promise<TaskAppProbeResult>{
  const checks:TaskAppProbeCheck[]=[];
  const blockers:string[]=[];
  let stderr=()=> "";
  const record=async(name:string,fn:()=>Promise<void>)=>{
    try{await fn();checks.push({name,ok:true,detail:"Observed successfully"});}
    catch(e){
      const message=e instanceof Error?e.message:String(e);
      // A crashing server resets the socket before its stack trace reaches our pipe.
      await new Promise(resolve=>setTimeout(resolve,150));
      const diagnostic=stderr();
      const detail=diagnostic?message+"\nServer stderr:\n"+diagnostic:message;
      checks.push({name,ok:false,detail});blockers.push(name+": "+detail);throw e;
    }
  };
  const serverFile=path.join(workspace,"src","server.mjs");
  const storageFile=path.join(workspace,".layanx","acceptance-tasks-"+randomUUID()+".json");
  let child:ChildProcess|undefined;
  try{
    if(!fs.existsSync(serverFile))throw Error("Missing src/server.mjs");
    fs.mkdirSync(path.dirname(storageFile),{recursive:true});
    let url="";
    const start=async()=>{
      stderr=()=> "";
      const started=await startServer(serverFile,workspace,storageFile);
      child=started.child;url=started.url;stderr=started.stderr;
    };
    await record("start",start);
    await record("health",async()=>{
      const res=await request(url,"/health");
      if(!res.ok||((await res.json()) as {ok?:unknown}).ok!==true)throw Error("GET /health must return {ok:true}");
    });
    await record("bilingual-home",async()=>{
      const res=await request(url,"/");
      const html=await res.text();
      const visibleText=html.replace(/<!--[\s\S]*?-->|<(script|style|head|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>/gi," ");
      if(!res.ok||!/\p{Script=Arabic}/u.test(visibleText)||!/[a-zA-Z]{3,}/.test(visibleText))
        throw Error("GET / must include Arabic and English page text, for example Tasks / المهام and Add / إضافة");
    });
    const title="LayanX acceptance "+randomUUID();
    let id:string|undefined;
    await record("create-task",async()=>{
      const res=await request(url,"/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title})});
      if(!res.ok)throw Error("POST /tasks HTTP "+res.status);
      const created=await res.json() as Record<string,unknown>;
      const task=created.task&&typeof created.task==="object"?created.task as Record<string,unknown>:created;
      if(task.title!==title||!(typeof task.id==="string"||typeof task.id==="number"))throw Error("POST /tasks must return the created task with id/title");
      id=String(task.id);
    });
    await record("list-task",async()=>{
      const tasks=await parseTasks(await request(url,"/tasks"));
      if(!tasks.some(t=>String(t.id)===id&&t.title===title))throw Error("Created task missing from GET /tasks");
    });
    // The empty-list home page proves nothing about rendering rows: server code
    // that builds them with browser-only APIs crashes only once a task exists.
    await record("home-with-task",async()=>{
      const res=await request(url,"/");
      if(!res.ok)throw Error("GET / HTTP "+res.status+" once a task exists");
      await res.text();
    });
    await stopServer(child);child=undefined;
    await record("restart",start);
    await record("persistent-create",async()=>{
      const tasks=await parseTasks(await request(url,"/tasks"));
      if(!tasks.some(t=>String(t.id)===id&&t.title===title))throw Error("Task was lost after a server restart");
    });
    await record("delete-task",async()=>{
      const res=await request(url,"/tasks/"+encodeURIComponent(id!),{method:"DELETE"});
      if(!res.ok)throw Error("DELETE /tasks/:id HTTP "+res.status);
      const tasks=await parseTasks(await request(url,"/tasks"));
      if(tasks.some(t=>String(t.id)===id))throw Error("Deleted task still appears in task list");
    });
    await stopServer(child);child=undefined;
    await record("restart-after-delete",start);
    await record("persistent-delete",async()=>{
      const tasks=await parseTasks(await request(url,"/tasks"));
      if(tasks.some(t=>String(t.id)===id))throw Error("Deleted task returned after restart");
    });
  }catch(e){
    if(!blockers.length)blockers.push(e instanceof Error?e.message:String(e));
  }finally{
    await stopServer(child);
    try{fs.rmSync(storageFile,{force:true});}catch{}
  }
  return {ok:blockers.length===0&&checks.length===11,checks,blockers,verificationScope:"real-http-and-restart"};
}
