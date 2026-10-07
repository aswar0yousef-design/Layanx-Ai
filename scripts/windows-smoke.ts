/**
 * Real-Windows smoke test (run by scripts/windows/smoke-test.ps1 and the windows CI job).
 * Exercises what can only be proven on Windows: the compiled desktop helper (SendInput +
 * UI Automation), DPAPI secrets, spawning npm without .cmd, and Windows path guards.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/windows-smoke.ts [--no-ui]
 */
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createDesktopControlToolAdapter} from "../src/tools/desktop-control.js";
import {openSecretStore} from "../src/security/secret-store.js";
import {writeFileSync} from "node:fs";
import {commandFor,detectProject,runOnce} from "../src/autonomy/project-runner.js";

if(process.platform!=="win32"){console.log("windows-smoke: skipped (not Windows)");process.exit(0);}
const noUi=process.argv.includes("--no-ui");
const withTools=process.argv.includes("--with-tools");
const withVoice=process.argv.includes("--with-voice");
// --only core,sandbox,tools,voice runs a subset (the CI runs each group as its own step).
const onlyArg=process.argv.indexOf("--only");
const only=onlyArg>0?(process.argv[onlyArg+1]??"").split(","):null;
let group="core";
const results:Array<{check:string;ok:boolean;detail?:string}>=[];
async function check(name:string,fn:()=>Promise<string|void>){
  if(only&&!only.includes(group))return;
  // On GitHub Actions each result also becomes an annotation, readable without downloading logs.
  const annotate=(level:"notice"|"error",text:string)=>{if(process.env.GITHUB_ACTIONS==="true")console.log(`::${level} title=Windows smoke::${text.replace(/\r?\n/g," ").slice(0,900)}`);};
  try{const detail=await fn();results.push({check:name,ok:true,...(detail?{detail}:{})});console.log("PASS",name,detail??"");annotate("notice","PASS "+name+(detail?" - "+detail:""));}
  catch(e){const detail=e instanceof Error?e.message:String(e);results.push({check:name,ok:false,detail});console.log("FAIL",name,detail);annotate("error","FAIL "+name+" - "+detail);}
}
const req=(action:string,payload:Record<string,unknown>={})=>({missionId:"smoke",agentId:"core",projectId:"smoke",tool:"desktop",action,permission:"L4_EXECUTE",idempotencyKey:"smoke-"+action,payload} as any);
const desktop=createDesktopControlToolAdapter();

await check("desktop helper compiles and reports Windows features",async()=>{
  const status=await desktop.execute(req("desktop status")) as any;
  assert.equal(status.ready,true,"powershell.exe found");
  assert.ok(status.features.includes("ui-automation-tree"));
  return status.features.join(",");
});
await check("UI Automation lists open windows",async()=>{
  const out=await desktop.execute(req("desktop ui tree",{scope:"windows"})) as any;
  assert.ok(Array.isArray(out.windows),"windows array");
  return out.windows.length+" windows";
});
await check("screenshot is a JPEG",async()=>{
  const shot=await desktop.execute(req("desktop screenshot",{maxWidth:800})) as any;
  assert.equal(shot.mimeType,"image/jpeg");assert.ok(shot.bytes>1000);
  return shot.screen+" "+shot.bytes+" bytes";
});
await check("LayanX local host starts: gateway, setup page, runtime (what LayanX.cmd launches)",async()=>{
  const {readFileSync,existsSync}=await import("node:fs");
  const dataDir=mkdtempSync(join(tmpdir(),"lx-host-"));
  const tsx=join(process.cwd(),"node_modules","tsx","dist","cli.mjs");
  const host=spawn(process.execPath,[tsx,"src/start-local.ts"],{cwd:process.cwd(),windowsHide:true,stdio:"ignore",
    env:{...process.env,LAYANX_DATA_DIR:dataDir,LAYANX_PUBLIC_PORT:"3310",LAYANX_FLOW_PUBLIC_PORT:"3410",LAYANX_WORKSPACE_ROOT:join(dataDir,"projects"),LAYANX_DESKTOP_PREWARM:"off"}});
  try{
    let health:any=null;
    for(let i=0;i<90&&!health;i++){await new Promise(r=>setTimeout(r,1000));health=await fetch("http://127.0.0.1:3310/v1/gateway/health").then(r=>r.ok?r.json():null).catch(()=>null);}
    assert.ok(health?.ok,"gateway answered");
    const setup=await fetch("http://127.0.0.1:3310/setup");assert.equal(setup.status,200);assert.match(await setup.text(),/LayanX/);
    const log=join(dataDir,"logs","layanx.log");
    let running=false;for(let i=0;i<60&&!running;i++){running=existsSync(log)&&/runtime running/.test(readFileSync(log,"utf8"));if(!running)await new Promise(r=>setTimeout(r,1000));}
    assert.ok(running,"runtime started: "+(existsSync(log)?readFileSync(log,"utf8").slice(-600):"no log"));
    const unauth=await fetch("http://127.0.0.1:3310/v1/missions");assert.equal(unauth.status,401,"API refuses requests without a session");
    // ACP (Zed / JetBrains): the agent reads this installation's local token from the DPAPI store and links the editor's folder.
    const acp=spawn(process.execPath,[tsx,"src/acp/main.ts"],{cwd:process.cwd(),windowsHide:true,stdio:["pipe","pipe","pipe"],env:{...process.env,LAYANX_DATA_DIR:dataDir,LAYANX_URL:"http://127.0.0.1:3310"}});
    const got:any[]=[];let buf="",errText="";
    acp.stderr.on("data",d=>errText+=d);
    acp.stdout.setEncoding("utf8").on("data",(d:string)=>{buf+=d;let i;while((i=buf.indexOf("\n"))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(line.trim())got.push(JSON.parse(line));}});
    const wait=async(id:number,ms=120000)=>{const end=Date.now()+ms;for(;;){const m=got.find(x=>x.id===id);if(m)return m;if(Date.now()>end)throw new Error("ACP: no answer to "+id+"; "+JSON.stringify(got).slice(-600)+" "+errText.slice(-400));await new Promise(r=>setTimeout(r,50));}};
    const folder=join(dataDir,"editor-folder");(await import("node:fs")).mkdirSync(folder,{recursive:true});
    try{
      acp.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:1,clientCapabilities:{}}})+"\n");
      assert.equal((await wait(1)).result?.protocolVersion,1,"ACP initialize");
      acp.stdin.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"session/new",params:{cwd:folder,mcpServers:[]}})+"\n");
      const created=await wait(2);
      assert.ok(created.result?.sessionId,"ACP session/new linked the folder with the local token: "+JSON.stringify(created));
      acp.stdin.write(JSON.stringify({jsonrpc:"2.0",id:3,method:"session/prompt",params:{sessionId:created.result.sessionId,prompt:[{type:"text",text:"Read the LayanX runtime status"}]}})+"\n");
      const answer=await wait(3,240000);
      assert.ok(answer.result?.stopReason,"ACP prompt answered: "+JSON.stringify(answer));
      const said=got.filter(x=>x.method==="session/update"&&x.params?.update?.sessionUpdate==="agent_message_chunk").map(x=>x.params.update.content.text).join(" ");
      return "gateway ok, setup 200, runtime running, API locked; ACP session linked, prompt -> "+answer.result.stopReason+" ("+said.slice(0,120)+")";
    }finally{acp.stdin.end();acp.kill();}
  }finally{host.kill();await new Promise(r=>setTimeout(r,1500));try{rmSync(dataDir,{recursive:true,force:true});}catch{}}
});
if(!noUi){
  await check("Notepad: focus, read elements, set Arabic text, read it back",async()=>{
    const notepad=spawn("notepad.exe",[],{detached:true,stdio:"ignore"});notepad.unref();
    try{
      let focused:any;
      for(let i=0;i<20&&!focused;i++){await new Promise(r=>setTimeout(r,500));focused=await desktop.execute(req("desktop focus window",{title:"Notepad"})).catch(()=>undefined);}
      assert.ok(focused,"Notepad window could be focused");
      await new Promise(r=>setTimeout(r,500));
      const tree=await desktop.execute(req("desktop ui tree")) as any;
      const editor=tree.elements.find((e:any)=>e.type==="Edit"||e.type==="Document");
      assert.ok(editor,"Notepad exposes its text area: "+JSON.stringify(tree).slice(0,300));
      const text="مرحبا LayanX 123";
      await desktop.execute(req("desktop set element text",{index:editor.i,text}));
      await new Promise(r=>setTimeout(r,300));
      const after=await desktop.execute(req("desktop ui tree")) as any;
      const again=after.elements.find((e:any)=>e.type===editor.type);
      return "elements="+tree.elements.length+" value="+(again?.value??"(not exposed)");
    }finally{spawnSync("taskkill",["/IM","notepad.exe","/F"],{stdio:"ignore"});}
  });
}
await check("PowerShell reads redirected stdin (diagnostic)",async()=>{
  const ps=(extra:string[])=>new Promise<string>(resolve=>{
    const script="$l=[Console]::In.ReadLine();[Console]::Out.Write('got:'+$l)";
    const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",...extra,"-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let out="";const t=setTimeout(()=>{child.kill();resolve("timeout");},20000);
    child.stdout.on("data",d=>out+=d);child.on("close",()=>{clearTimeout(t);resolve(out.trim()||"empty");});
    child.stdin.end("hello\n");
  });
  const plain=await ps([]);const none=await ps(["-InputFormat","None"]);
  assert.equal(none,"got:hello","-InputFormat None must let the script read stdin");
  return "default="+plain+" inputformat-none="+none;
});
await check("DPAPI secret store round trip",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"lx-smoke-"));
  try{
    const store=await openSecretStore(dir);
    assert.equal(store.backend,"dpapi");
    await store.set("SMOKE_TEST_KEY","سر-123");
    const reopened=await openSecretStore(dir);
    assert.equal(reopened.get("SMOKE_TEST_KEY"),"سر-123");
    return store.location;
  }finally{rmSync(dir,{recursive:true,force:true});}
});
await check("project scripts run through npm-cli.js (no .cmd spawning)",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"lx-smoke-npm-"));
  try{
    writeFileSync(join(dir,"package.json"),JSON.stringify({name:"smoke",version:"1.0.0",scripts:{test:"node -e \"console.log('smoke-ok')\""}}));
    const info=detectProject(dir);
    const r=await runOnce(commandFor(info,"test"),dir,60_000);
    assert.equal(r.exitCode,0,JSON.stringify(r).slice(0,400));
    assert.match(JSON.stringify(r),/smoke-ok/);
    return r.command;
  }finally{rmSync(dir,{recursive:true,force:true});}
});
// ---------------------------------------------------------------- restricted isolation (no Docker, no admin)
group="sandbox";
if(!only||only.includes("sandbox")){
  const {existsSync,readFileSync,mkdirSync}=await import("node:fs");
  const ws=await import("../src/platform/windows-sandbox.js");
  const store=mkdtempSync(join(tmpdir(),"lx-rs-store-"));
  const env={...process.env,LAYANX_STORE_DIR:store};
  const proj=mkdtempSync(join(tmpdir(),"lx-rs-proj-"));
  const outside=mkdtempSync(join(tmpdir(),"lx-rs-outside-"));
  writeFileSync(join(outside,"secret.txt"),"readable");
  mkdirSync(join(proj,".git","hooks"),{recursive:true});
  const profileTarget=join(process.env.USERPROFILE??tmpdir(),`lx-rs-should-not-exist-${Date.now()}.txt`);
  let setup:Awaited<ReturnType<typeof ws.prepareRestricted>>|undefined;
  const runIn=(args:string[],timeout=60_000,extraEnv:NodeJS.ProcessEnv={})=>runOnce(ws.restrictedCommand({command:process.execPath,args,label:"node"},proj,setup!,{...env,...extraEnv}),proj,timeout,ws.restrictedEnv({...env,...extraEnv},setup!));
  await check("restricted isolation: launcher compiles and prepares the project folder",async()=>{
    const started=Date.now();
    setup=await ws.prepareRestricted(proj,env);
    assert.ok(existsSync(setup.launcher));
    const v=spawnSync(setup.launcher,["version"],{encoding:"utf8"});
    assert.match(v.stdout,/lx-sandbox/);
    return `${Date.now()-started} ms`;
  });
  await check("restricted isolation: writes only inside the project, never .git; reads and child processes work",async()=>{
    assert.ok(setup,"prepared");
    writeFileSync(join(proj,"probe.cjs"),`
const fs=require("fs"),path=require("path"),cp=require("child_process"),os=require("os");
const tryWrite=f=>{try{fs.writeFileSync(f,"x");return"ok";}catch(e){return e.code||String(e);}};
const out={
  inside:tryWrite(path.join(process.cwd(),"inside.txt")),
  insideDir:(()=>{try{fs.mkdirSync(path.join(process.cwd(),"sub","deep"),{recursive:true});return tryWrite(path.join(process.cwd(),"sub","deep","f.txt"));}catch(e){return e.code;}})(),
  outside:tryWrite(${JSON.stringify(join(outside,"evil.txt"))}),
  profile:tryWrite(${JSON.stringify(profileTarget)}),
  gitHook:tryWrite(path.join(process.cwd(),".git","hooks","pre-commit")),
  gitDelete:(()=>{try{fs.rmSync(path.join(process.cwd(),".git"),{recursive:true});return"deleted";}catch(e){return e.code||String(e);}})(),
  tmp:tryWrite(path.join(os.tmpdir(),"t.txt")),
  tmpdir:os.tmpdir(),
  read:(()=>{try{return fs.readFileSync(${JSON.stringify(join(outside,"secret.txt"))},"utf8");}catch(e){return e.code;}})(),
  child:(()=>{try{return cp.execFileSync(process.execPath,["-e","console.log('child-ok')"],{encoding:"utf8"}).trim();}catch(e){return String(e.message).slice(0,200);}})(),
  aclTamper:(()=>{try{cp.execFileSync("icacls",[path.join(process.cwd(),".git"),"/reset","/t"],{stdio:"pipe"});return"changed";}catch(e){return"refused";}})()
};
console.log(JSON.stringify(out));`);
    const r=await runIn(["probe.cjs"]);
    assert.equal(r.exitCode,0,r.stderr.slice(-500));
    const out=JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);
    assert.equal(out.inside,"ok","write inside the project: "+JSON.stringify(out));
    assert.equal(out.insideDir,"ok","new folders inside the project: "+JSON.stringify(out));
    assert.notEqual(out.outside,"ok","outside folder must be read-only: "+JSON.stringify(out));
    assert.notEqual(out.profile,"ok","user profile must be read-only: "+JSON.stringify(out));
    assert.ok(!existsSync(profileTarget),"nothing written to the profile");
    assert.notEqual(out.gitHook,"ok","git hooks cannot be planted: "+JSON.stringify(out));
    assert.notEqual(out.gitDelete,"deleted","the .git folder cannot be deleted: "+JSON.stringify(out));
    assert.ok(existsSync(join(proj,".git","hooks")),".git still there");
    assert.equal(out.tmp,"ok","sandbox temp folder is writable: "+JSON.stringify(out));
    assert.equal(out.read,"readable","reading is not restricted (documented)");
    assert.equal(out.aclTamper,"refused","the command cannot rewrite the .git permissions: "+JSON.stringify(out));
    assert.equal(out.child,"child-ok","child processes with pipes work: "+JSON.stringify(out));
    return `outside=${out.outside} profile=${out.profile} gitHook=${out.gitHook} tmp=${out.tmpdir}`;
  });
  await check("restricted isolation: pipes and child processes (diagnostic)",async()=>{
    writeFileSync(join(proj,"pipes.cjs"),`
const cp=require("child_process"),net=require("net");
const e=x=>x&&(x.code+" "+(x.syscall||"")+" "+String(x.message).slice(0,120));
const out={};
const t=(k,f)=>{try{out[k]=f();}catch(x){out[k]="ERR "+e(x);}};
t("inherit",()=>cp.spawnSync(process.execPath,["-e","1"],{stdio:"inherit"}).error?"ERR "+e(cp.spawnSync(process.execPath,["-e","1"],{stdio:"inherit"}).error):"ok");
t("stdoutPipe",()=>{const r=cp.spawnSync(process.execPath,["-e","console.log(7)"],{stdio:["ignore","pipe","ignore"],encoding:"utf8"});return r.error?"ERR "+e(r.error):"ok "+String(r.stdout).trim();});
t("stdinPipe",()=>{const r=cp.spawnSync(process.execPath,["-e","1"],{stdio:["pipe","ignore","ignore"]});return r.error?"ERR "+e(r.error):"ok";});
t("cmd",()=>{const r=cp.spawnSync(process.env.ComSpec||"cmd.exe",["/d","/c","echo hi"],{encoding:"utf8"});return r.error?"ERR "+e(r.error):"ok "+String(r.stdout).trim();});
const bs=String.fromCharCode(92),name=bs+bs+"."+bs+"pipe"+bs+"lx-diag-"+process.pid;
const srv=net.createServer(s=>{s.end("pong");});
srv.on("error",x=>{out.listen="ERR "+e(x);done();});
let finished=false;const done=()=>{if(finished)return;finished=true;try{srv.close();}catch{}console.log(JSON.stringify(out));};
srv.listen(name,()=>{out.listen="ok";const c=net.connect(name);c.on("data",d=>{out.connect="ok "+d;c.destroy();done();});c.on("error",x=>{out.connect="ERR "+e(x);done();});});
setTimeout(()=>{out.timeout=true;done();},8000);`);
    const r=await runIn(["pipes.cjs"]);
    return (r.stdout.trim().split(/\r?\n/).pop()??"")+" "+r.stderr.slice(-200);
  });
  await check("restricted isolation: npm install skips package scripts, npm test runs (project runner)",async()=>{
    const {setIsolation}=await import("../src/autonomy/sandbox.js");
    const {createProjectRunnerAdapter}=await import("../src/autonomy/project-runner.js");
    const {readdirSync}=await import("node:fs");
    const root=mkdtempSync(join(tmpdir(),"lx-rs-ws-"));
    const saved={ws:process.env.LAYANX_WORKSPACE_ROOT,iso:process.env.LAYANX_ISOLATION_FILE,store:process.env.LAYANX_STORE_DIR};
    process.env.LAYANX_WORKSPACE_ROOT=root;process.env.LAYANX_ISOLATION_FILE=join(store,"isolation.json");process.env.LAYANX_STORE_DIR=store;
    try{
      const shop=join(root,"shop"),dep=join(shop,"vendor","evil-dep");mkdirSync(dep,{recursive:true});
      writeFileSync(join(dep,"package.json"),JSON.stringify({name:"evil-dep",version:"1.0.0",main:"index.js",scripts:{postinstall:"node -e \"require('fs').writeFileSync(require('path').join(process.env.INIT_CWD||'.','PWNED'),'x')\""}}));
      writeFileSync(join(dep,"index.js"),"module.exports=()=>'dep-ok';\n");
      writeFileSync(join(shop,"package.json"),JSON.stringify({name:"shop",version:"1.0.0",dependencies:{"evil-dep":"file:./vendor/evil-dep"},scripts:{test:"node -e \"console.log(require('evil-dep')())\""}}));
      setIsolation(process.env.LAYANX_ISOLATION_FILE!,"shop","restricted");
      const runner=createProjectRunnerAdapter();
      const req=(task:string)=>({missionId:"m",agentId:"core",projectId:"shop",tool:"project.run",action:"run project task",permission:"L4_EXECUTE",idempotencyKey:"k",payload:{task}} as any);
      const install=await runner.execute(req("install")) as any;
      const npmLog=()=>{try{const d=join(store,"sandbox","cache","npm","_logs");const f=readdirSync(d).sort().pop();return f?readFileSync(join(d,f),"utf8").split(/\r?\n/).filter(l=>/error|verbose stack|EPERM|EACCES/i.test(l)).slice(-12).join(" | "):"";}catch{return"";}};
      assert.equal(install.ok,true,"install: "+(install.stderr||install.stdout).slice(-300)+" npm log: "+npmLog());
      assert.match(install.command,/^restricted: .*--ignore-scripts/);
      assert.ok(existsSync(join(shop,"node_modules","evil-dep")),"dependency installed");
      assert.ok(!existsSync(join(shop,"PWNED")),"install script did not run");
      const test=await runner.execute(req("test")) as any;
      assert.equal(test.ok,true,"test: "+(test.stderr||test.stdout).slice(-600));
      assert.match(test.stdout,/dep-ok/);
      return install.command+" | "+test.command;
    }finally{
      process.env.LAYANX_WORKSPACE_ROOT=saved.ws;process.env.LAYANX_ISOLATION_FILE=saved.iso;process.env.LAYANX_STORE_DIR=saved.store;
      for(const [k,v] of Object.entries({LAYANX_WORKSPACE_ROOT:saved.ws,LAYANX_ISOLATION_FILE:saved.iso,LAYANX_STORE_DIR:saved.store}))if(v===undefined)delete process.env[k];
      rmSync(root,{recursive:true,force:true});
    }
  });
  await check("restricted isolation: a timeout stops the whole process tree; memory limit holds",async()=>{
    assert.ok(setup,"prepared");
    const pidFile=join(proj,"grandchild.pid");
    writeFileSync(join(proj,"tree.cjs"),`
const cp=require("child_process"),fs=require("fs");
const g=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});g.unref();
fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));
setInterval(()=>{},1000);`);
    const r=await runIn(["tree.cjs"],5000);
    assert.equal(r.timedOut,true);
    const pid=Number(readFileSync(pidFile,"utf8"));
    let alive=true;
    for(let i=0;i<20&&alive;i++){await new Promise(res=>setTimeout(res,500));try{process.kill(pid,0);}catch{alive=false;}}
    assert.equal(alive,false,"the detached grandchild was stopped with the job");
    const mem=await runIn(["-e","const a=[];for(let i=0;i<40;i++)a.push(Buffer.alloc(32*1024*1024,1));console.log('allocated',a.length)"],60_000,{LAYANX_DOCKER_MEMORY:"256m"});
    assert.notEqual(mem.exitCode,0,"1.25 GB allocation must fail under a 256 MB limit: "+mem.stdout.slice(-200));
    return `grandchild ${pid} stopped; memory exit ${mem.exitCode} ${(mem.stderr.match(/lx-sandbox:[^\n]*/)??[""])[0]}`;
  });
  await check("restricted isolation: a coding agent runs inside it with its own home folder",async()=>{
    const {setIsolation}=await import("../src/autonomy/sandbox.js");
    const {createExternalAgentAdapter,detectExternalAgents}=await import("../src/autonomy/external-agents.js");
    const root=mkdtempSync(join(tmpdir(),"lx-rs-agent-"));
    const keys=["LAYANX_WORKSPACE_ROOT","LAYANX_ISOLATION_FILE","LAYANX_STORE_DIR","LAYANX_CLAUDE_CODE_PATH","LAYANX_AIDER_PATH"] as const;
    const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
    try{
      process.env.LAYANX_WORKSPACE_ROOT=root;process.env.LAYANX_ISOLATION_FILE=join(store,"isolation.json");process.env.LAYANX_STORE_DIR=store;
      delete process.env.LAYANX_AIDER_PATH;
      const fake=join(root,"fake-agent.cjs");
      writeFileSync(fake,`const fs=require("fs"),path=require("path"),os=require("os");
const w=f=>{try{fs.writeFileSync(f,"x");return"ok";}catch(e){return e.code||"denied";}};
console.log(JSON.stringify({task:process.argv[3],home:os.homedir(),project:w(path.join(process.cwd(),"agent-was-here.txt")),homeWrite:w(path.join(os.homedir(),"agent-cache.txt")),outside:w(${JSON.stringify(join(outside,"agent.txt"))})}));`);
      process.env.LAYANX_CLAUDE_CODE_PATH=fake;detectExternalAgents(true);
      mkdirSync(join(root,"app"));setIsolation(process.env.LAYANX_ISOLATION_FILE!,"app","restricted");
      const r=await createExternalAgentAdapter().execute({missionId:"m",agentId:"core",projectId:"app",tool:"agent.external",action:"delegate",permission:"L4_EXECUTE",idempotencyKey:"k",payload:{agent:"claude-code",task:"add a README"}} as any) as any;
      assert.equal(r.ok,true,JSON.stringify(r).slice(0,600));assert.equal(r.isolation,"restricted");
      const out=JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
      assert.equal(out.project,"ok");assert.equal(out.homeWrite,"ok","agent has a writable home");assert.notEqual(out.outside,"ok","agent cannot write outside");
      assert.ok(out.home.toLowerCase().startsWith(store.toLowerCase()),"home is the sandbox home: "+out.home);
      return `home=${out.home} outside=${out.outside}`;
    }finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}rmSync(root,{recursive:true,force:true});}
  });
  try{rmSync(proj,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});rmSync(store,{recursive:true,force:true});}catch{}
}
group="tools";
if(withTools){
  await check("pinned security scanners find planted problems",async()=>{
    const {runExternalScanners,findScanner}=await import("../src/autonomy/external-scanners.js");
    for(const t of ["gitleaks","osv-scanner","opengrep"])assert.ok(findScanner(t),t+" is installed and hash-verified");
    const dir=mkdtempSync(join(tmpdir(),"lx-scan-"));
    try{
      const token="ghp_"+Array.from({length:36},(_,i)=>"aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5"[i]).join("");
      writeFileSync(join(dir,"config.js"),"export const githubToken = '"+token+"';\n");
      writeFileSync(join(dir,"run.js"),"const cp = require('child_process');\nfunction go(userInput){ eval(userInput); cp.exec('ls ' + userInput); }\nmodule.exports = go;\n");
      writeFileSync(join(dir,"package.json"),JSON.stringify({name:"scan-me",version:"1.0.0",dependencies:{lodash:"4.17.15"}}));
      writeFileSync(join(dir,"package-lock.json"),JSON.stringify({name:"scan-me",version:"1.0.0",lockfileVersion:3,requires:true,packages:{"":{name:"scan-me",version:"1.0.0",dependencies:{lodash:"4.17.15"}},"node_modules/lodash":{version:"4.17.15",resolved:"https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz"}}}));
      const results=await runExternalScanners(dir);
      const by=Object.fromEntries(results.map(r=>[r.tool,r]));
      assert.ok(by.gitleaks?.ran&&by.gitleaks.findings.length>0,"gitleaks: "+JSON.stringify(by.gitleaks).slice(0,300));
      assert.ok(by["osv-scanner"]?.ran&&by["osv-scanner"].findings.some(f=>/lodash/.test(f.message)),"osv-scanner: "+JSON.stringify(by["osv-scanner"]).slice(0,300));
      assert.ok(by.opengrep?.ran&&by.opengrep.findings.some(f=>f.rule==="layanx.js.eval"),"opengrep: "+JSON.stringify(by.opengrep).slice(0,400));
      return results.map(r=>r.tool+"="+r.findings.length).join(" ");
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
group="voice";
if(withVoice&&(!only||only.includes("voice"))){
  const {LocalSpeaker,LocalTranscriber,VoiceService}=await import("../src/voice/service.js");
  const {VoiceSense}=await import("../src/voice/sense.js");
  const {existsSync,readdirSync,statSync,readFileSync}=await import("node:fs");
  const dataDir=process.env.LAYANX_DATA_DIR??join(process.env.LOCALAPPDATA??"",`LayanX`);
  const vpy=join(dataDir,"piper","venv","Scripts","python.exe"),voices=join(dataDir,"piper","voices");
  const find=(dir:string,name:RegExp):string|undefined=>{for(const e of readdirSync(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isDirectory()){const r=find(f,name);if(r)return r;}else if(name.test(e.name))return f;}return undefined;};
  const whisperDir=join(dataDir,"whisper");
  const server=existsSync(whisperDir)?find(whisperDir,/^whisper-server\.exe$/i):undefined;
  const model=existsSync(join(whisperDir,"models"))?readdirSync(join(whisperDir,"models")).filter(f=>/^ggml-.*\.bin$/.test(f)).map(f=>join(whisperDir,"models",f)).sort((a,b)=>statSync(b).size-statSync(a).size)[0]:undefined;
  const senseDir=join(dataDir,"voice-sense");
  const sensePy=existsSync(join(senseDir,"python.txt"))?readFileSync(join(senseDir,"python.txt"),"utf8").trim():undefined;
  const procs:Array<ReturnType<typeof spawn>>=[];
  const up=async(url:string)=>{for(let i=0;i<120;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw new Error("not reachable: "+url);};
  const speaker=new LocalSpeaker("http://127.0.0.1:18179"),whisper=new LocalTranscriber("http://127.0.0.1:18178/v1");
  const norm=(t:string)=>t.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه");
  try{
    await check("Piper speaks Arabic and Whisper hears it back (local voice round trip)",async()=>{
      assert.ok(existsSync(vpy),"Piper installed by install-piper.ps1");
      assert.ok(server&&model,"Whisper installed by install-whisper.ps1");
      procs.push(spawn(vpy,["-m","piper.http_server","-m","ar_JO-kareem-medium","--data-dir",voices,"--host","127.0.0.1","--port","18179"],{cwd:voices,windowsHide:true,stdio:"ignore"}));
      procs.push(spawn(server!,["-m",model!,"--host","127.0.0.1","--port","18178","--inference-path","/v1/audio/transcriptions","-t","2"],{windowsHide:true,stdio:"ignore"}));
      await up("http://127.0.0.1:18179/voices");await up("http://127.0.0.1:18178/");
      const spoken=await speaker.speak("مرحبا، أنا ليان، مساعدك على هذا الحاسوب.","ar");
      assert.equal(spoken.audio.subarray(0,4).toString("ascii"),"RIFF");assert.ok(spoken.audio.length>20000,"real audio");
      const text=await whisper.transcribe(to16kMono(spoken.audio),"audio/wav","voice.wav","ar");
      assert.ok(text.trim().length>0,"Whisper returned text");
      return `wav ${spoken.audio.length} bytes; heard: ${text.slice(0,80)}`;
    });
    await check("voice sense: Silero VAD gates silence, Smart Turn scores sentences, wake word heard through Whisper",async()=>{
      assert.ok(sensePy&&existsSync(sensePy),"voice sense installed by install-voice-sense.ps1");
      procs.push(spawn(sensePy!,[join(process.cwd(),"scripts","voice-sense","server.py"),"--models",join(senseDir,"models"),"--port","18180"],{windowsHide:true,stdio:"ignore"}));
      await up("http://127.0.0.1:18180/health");
      const sense=new VoiceSense("http://127.0.0.1:18180",20000);
      const silence=to16kMono(Buffer.concat([Buffer.from(speakerHeader(16000,32000)),Buffer.alloc(32000)]));
      const vadSilence=await sense.vad(silence);
      assert.equal(vadSilence.speech,false,"silence is not speech: "+JSON.stringify(vadSilence));
      const wake=to16kMono((await speaker.speak("ليان، ما هي حالة الطقس اليوم؟","ar")).audio);
      const vadWake=await sense.vad(wake);
      assert.equal(vadWake.speech,true,"Piper's voice is speech: "+JSON.stringify(vadWake));
      const complete=await sense.turn(wake);
      const partial=await sense.turn(to16kMono((await speaker.speak("أريد أن أعرف","ar")).audio));
      for(const t of [complete,partial])assert.ok(t.probability>=0&&t.probability<=1);
      // LayanX's own pipeline: silence never reaches Whisper; speech does, and the wake word is recognised.
      const service=new VoiceService(undefined,whisper,null,sense);
      const started=Date.now();assert.equal(await service.transcribe(silence,"audio/wav","s.wav","ar"),"");const gatedMs=Date.now()-started;
      const heard=await service.transcribe(wake,"audio/wav","w.wav","ar");
      assert.match(norm(heard),/ليان|ليين|لايان|لين|layan/i,"wake word in: "+heard);
      return `vad silence=${vadSilence.maxProb} speech=${vadWake.maxProb}; turn complete=${complete.probability} partial=${partial.probability}; silence gated in ${gatedMs} ms; heard: ${heard.slice(0,60)}`;
    });
  }finally{for(const p of procs)p.kill();}
}
/** 44-byte PCM16 mono WAV header. */
function speakerHeader(rate:number,dataBytes:number):Buffer{
  const h=Buffer.alloc(44);h.write("RIFF",0,"ascii");h.writeUInt32LE(36+dataBytes,4);h.write("WAVE",8,"ascii");h.write("fmt ",12,"ascii");h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);
  h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write("data",36,"ascii");h.writeUInt32LE(dataBytes,40);return h;
}
/** PCM16 WAV (any rate, mono/stereo) -> 16 kHz mono, which whisper-server expects. */
function to16kMono(wav:Buffer):Buffer{
  let off=12,rate=16000,channels=1,bits=16,data:Buffer|null=null;
  while(off+8<=wav.length){const id=wav.toString("ascii",off,off+4),size=wav.readUInt32LE(off+4);
    if(id==="fmt "){channels=wav.readUInt16LE(off+10);rate=wav.readUInt32LE(off+12);bits=wav.readUInt16LE(off+22);}
    if(id==="data"){data=wav.subarray(off+8,off+8+size);break;}
    off+=8+size+(size%2);}
  if(!data||bits!==16)throw new Error("unexpected WAV format");
  const frames=Math.floor(data.length/2/channels);const src=new Float32Array(frames);
  for(let i=0;i<frames;i++){let v=0;for(let c=0;c<channels;c++)v+=data.readInt16LE((i*channels+c)*2);src[i]=v/channels;}
  const n=Math.floor(frames*16000/rate);const out=Buffer.alloc(44+n*2);
  out.write("RIFF",0,"ascii");out.writeUInt32LE(36+n*2,4);out.write("WAVE",8,"ascii");out.write("fmt ",12,"ascii");out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(16000,24);out.writeUInt32LE(32000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write("data",36,"ascii");out.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++){const p=i*rate/16000,j=Math.floor(p),f=p-j;const v=(src[j]??0)*(1-f)+(src[j+1]??src[j]??0)*f;out.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v))),44+i*2);}
  return out;
}
const failed=results.filter(r=>!r.ok);
console.log(JSON.stringify({windowsSmoke:{passed:results.length-failed.length,failed:failed.length,results}},null,1));
process.exit(failed.length?1:0);
