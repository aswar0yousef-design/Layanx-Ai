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

async function startServer(serverFile:string,workspace:string,storageFile:string):Promise<{child:ChildProcess;url:string}>{
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
      child.stderr?.removeAllListeners("data");
      child.removeListener("error",onError);
      child.removeListener("exit",onExit);
      if(error){child.kill();reject(error);}
      else resolve({child,url:url!});
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
  const record=async(name:string,fn:()=>Promise<void>)=>{
    try{await fn();checks.push({name,ok:true,detail:"Observed successfully"});}
    catch(e){const detail=e instanceof Error?e.message:String(e);checks.push({name,ok:false,detail});blockers.push(name+": "+detail);throw e;}
  };
  const serverFile=path.join(workspace,"src","server.mjs");
  const storageFile=path.join(workspace,".layanx","acceptance-tasks-"+randomUUID()+".json");
  let child:ChildProcess|undefined;
  try{
    if(!fs.existsSync(serverFile))throw Error("Missing src/server.mjs");
    fs.mkdirSync(path.dirname(storageFile),{recursive:true});
    let url="";
    await record("start",async()=>{const started=await startServer(serverFile,workspace,storageFile);child=started.child;url=started.url;});
    await record("health",async()=>{
      const res=await request(url,"/health");
      if(!res.ok||((await res.json()) as {ok?:unknown}).ok!==true)throw Error("GET /health must return {ok:true}");
    });
    await record("bilingual-home",async()=>{
      const res=await request(url,"/");
      const html=await res.text();
      if(!res.ok||!/[\u0600-\u06FF]/.test(html)||!/[a-zA-Z]{3,}/.test(html))
        throw Error("GET / must serve both Arabic and English content");
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
    await stopServer(child);child=undefined;
    await record("restart",async()=>{const started=await startServer(serverFile,workspace,storageFile);child=started.child;url=started.url;});
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
    await record("restart-after-delete",async()=>{const started=await startServer(serverFile,workspace,storageFile);child=started.child;url=started.url;});
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
  return {ok:blockers.length===0&&checks.length===10,checks,blockers,verificationScope:"real-http-and-restart"};
}
