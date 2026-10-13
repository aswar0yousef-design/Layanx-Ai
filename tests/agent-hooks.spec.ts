import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-hooks-store-"));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-hooks-"));
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
fs.mkdirSync(path.join(root,"projects","shop"),{recursive:true});
const {installAgentHooks,uninstallAgentHooks,agentHooksStatus,HOOK_SCRIPT}=await import("../src/local/agent-hooks.js");

// ---------- 1. installing into Claude Code / Codex settings: backup first, keep everything else ----------
const home=path.join(root,"home");const dataDir=path.join(root,"data");
fs.mkdirSync(path.join(home,".claude"),{recursive:true});fs.mkdirSync(dataDir,{recursive:true});
const claudeFile=path.join(home,".claude","settings.json");
const original={model:"opus",permissions:{allow:["Bash(git status)"]},hooks:{
  PreToolUse:[{matcher:"Bash",hooks:[{type:"command",command:"python3 mine.py"}]}],
  PermissionRequest:[{matcher:"Read",hooks:[{type:"command",command:"my-own-hook"}]}]}};
fs.writeFileSync(claudeFile,JSON.stringify(original,null,2));
const env={} as NodeJS.ProcessEnv;
const opts={dataDir,port:3999,home,env,node:"C:\\Program Files\\nodejs\\node.exe",now:()=>new Date("2026-10-13T12:00:00Z")};
const first=installAgentHooks(opts);
assert.deepEqual(first.map(r=>r.agent),["claude"],"only agents that are installed (their settings folder exists)");
assert.equal(first[0]!.changed,true);
assert.equal(first[0]!.backup,claudeFile+".layanx-backup-20261013120000");
assert.deepEqual(JSON.parse(fs.readFileSync(first[0]!.backup!,"utf8")),original,"the backup is the file as it was");
const after=JSON.parse(fs.readFileSync(claudeFile,"utf8"));
assert.equal(after.model,"opus");assert.deepEqual(after.permissions,original.permissions);assert.deepEqual(after.hooks.PreToolUse,original.hooks.PreToolUse);
assert.equal(after.hooks.PermissionRequest.length,2,"the owner's own hook stays");
const ours=after.hooks.PermissionRequest[1].hooks[0];
assert.equal(ours.type,"command");assert.equal(ours.timeout,150);
assert.equal(ours.command,`"C:/Program Files/nodejs/node.exe" "${HOOK_SCRIPT.replace(/\\/g,"/")}" claude "${path.join(dataDir,"agent-hooks.json").replace(/\\/g,"/")}" 120`);
const token=JSON.parse(fs.readFileSync(path.join(dataDir,"agent-hooks.json"),"utf8"));
assert.match(token.token,/^lxh_[A-Za-z0-9_-]{43}$/);assert.equal(token.port,3999);
const again=installAgentHooks(opts);
assert.equal(again[0]!.changed,false,"installing twice changes nothing");
assert.equal(fs.readdirSync(path.join(home,".claude")).filter(f=>f.includes("layanx-backup")).length,1,"and makes no second backup");
assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,"agent-hooks.json"),"utf8")).token,token.token,"same token");
const codex=installAgentHooks({...opts,agents:["codex"]});
assert.equal(codex[0]!.file,path.join(home,".codex","hooks.json"));assert.equal(codex[0]!.backup,undefined,"nothing to back up");
assert.match(codex[0]!.note??"",/\/hooks/,"Codex must trust a new hook once");
assert.match(JSON.parse(fs.readFileSync(codex[0]!.file,"utf8")).hooks.PermissionRequest[0].hooks[0].command,/ codex /);
assert.deepEqual(agentHooksStatus({dataDir,home,env}).map(a=>[a.agent,a.installed]),[["claude",true],["codex",true]]);
// a damaged settings file is never touched
const broken=path.join(root,"broken");fs.mkdirSync(path.join(broken,".claude"),{recursive:true});fs.writeFileSync(path.join(broken,".claude","settings.json"),"{ not json");
const bad=installAgentHooks({...opts,home:broken});
assert.match(bad[0]!.error??"",/not valid JSON/);assert.equal(fs.readFileSync(path.join(broken,".claude","settings.json"),"utf8"),"{ not json");
// uninstall removes only what LayanX added
const removed=uninstallAgentHooks({dataDir,home,env,now:()=>new Date("2026-10-13T12:05:00Z")});
assert.ok(removed.every(r=>r.changed));
const cleaned=JSON.parse(fs.readFileSync(claudeFile,"utf8"));
assert.deepEqual(cleaned,original,"back to exactly the owner's settings");
assert.equal(JSON.parse(fs.readFileSync(path.join(home,".codex","hooks.json"),"utf8")).hooks,undefined);
assert.equal(fs.existsSync(path.join(dataDir,"agent-hooks.json")),false,"the hook token is gone");

// ---------- 2. end to end: hook -> LayanX -> phone decision (digest) -> hook answer ----------
const {startRuntimeApi}=await import("../src/api-server.js");
const {LayanXCore}=await import("../src/core/orchestrator.js");
const {AccessManager}=await import("../src/security/access.js");
const {startGateway,freeLoopbackPort}=await import("../src/security/local-gateway.js");
const core=new LayanXCore();
const api=startRuntimeApi({core,host:"127.0.0.1",port:0,token:"internal-token",requireToken:true});
await new Promise<void>(r=>api.on("listening",()=>r()));
const apiPort=(api.address() as {port:number}).port;
const hooksFile=path.join(dataDir,"agent-hooks.json");
const access=new AccessManager({devicesFile:path.join(root,"devices.json"),launchTicketFile:path.join(root,"ticket.json"),masterToken:"lxm_owner",hooksFile});
const port=await freeLoopbackPort();
const gw=await startGateway({bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:port,internalPort:apiPort}],access,internalToken:"internal-token",mobileAccess:false,log:()=>undefined,handleOwnRoute:async ctx=>{
  if(ctx.url.pathname==="/v1/projects/link"){ctx.sendJson(ctx.principal?200:401,{reached:true});return true;}
  return false;
}});
installAgentHooks({dataDir,port,home,env,agents:["claude"]});
const hookToken=JSON.parse(fs.readFileSync(hooksFile,"utf8")).token as string;
const phoneToken=(access.completePairing(access.startPairing().code,"phone","test") as {deviceToken:string}).deviceToken;
const req=(method:string,p:string,token:string,body?:unknown)=>new Promise<{status:number;json:any}>((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const r=http.request({host:"127.0.0.1",port,method,path:p,headers:{authorization:"Bearer "+token,...(payload?{"content-type":"application/json"}:{})}},res=>{let t="";res.on("data",c=>t+=c);res.on("end",()=>{let json:any=null;try{json=JSON.parse(t);}catch{}resolve({status:res.statusCode??0,json});});});
  r.on("error",reject);if(payload)r.write(payload);r.end();
});
const runHook=(input:unknown,wait="20",config=hooksFile)=>new Promise<{code:number|null;out:string}>(resolve=>{
  const child=spawn(process.execPath,[HOOK_SCRIPT,"claude",config,wait],{stdio:["pipe","pipe","pipe"]});
  let out="";child.stdout.on("data",d=>out+=d);child.on("close",code=>resolve({code,out}));
  child.stdin.end(JSON.stringify(input));
});
const pending=async()=>(await req("GET","/v1/companion/feed?load=0",phoneToken)).json.approvals as any[];
const until=async(f:()=>Promise<boolean>,ms=10_000)=>{const end=Date.now()+ms;while(!await f()){if(Date.now()>end)throw new Error("timeout");await new Promise(r=>setTimeout(r,100));}};
const ask={hook_event_name:"PermissionRequest",session_id:"sess-1",cwd:path.join(root,"projects","shop","src"),permission_mode:"default",tool_name:"Bash",tool_input:{command:"npm install left-pad"}};
try{
  // the hook token asks; it cannot read, decide or reach anything else
  assert.equal((await req("GET","/v1/companion/feed",hookToken)).status,403);
  assert.equal((await req("GET","/v1/approvals?projectId=shop",hookToken)).status,403);
  assert.equal((await req("POST","/v1/projects/link",hookToken,{})).status,403,"not even the gateway's own routes");
  assert.equal((await req("POST","/v1/external/approvals",phoneToken,{tool:"Bash"})).status,403,"a phone cannot invent requests");

  // approve from the phone
  const approving=runHook(ask);
  await until(async()=>(await pending()).length===1);
  const a=(await pending())[0];
  assert.equal(a.external,true);assert.equal(a.projectId,"shop","the folder maps to its project");
  assert.match(a.reason,/Claude Code: npm install left-pad/);assert.equal(a.tool,"Bash");
  assert.equal((await req("POST",`/v1/approvals/${a.id}/approve?projectId=shop`,hookToken,{digest:a.digest})).status,403,"the hook never decides");
  assert.equal((await req("POST",`/v1/approvals/${a.id}/approve?projectId=shop`,phoneToken,{})).status,428,"the phone must send the digest");
  const ok=await req("POST",`/v1/approvals/${a.id}/approve?projectId=shop`,phoneToken,{digest:a.digest,resume:true});
  assert.equal(ok.status,200);assert.equal(ok.json.continuing,"external");
  const allowed=await approving;
  assert.equal(allowed.code,0);
  assert.deepEqual(JSON.parse(allowed.out),{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}});

  // reject from the phone
  const rejecting=runHook({...ask,tool_name:"Write",tool_input:{file_path:"/etc/hosts",content:"x"}});
  await until(async()=>(await pending()).length===1);
  const b=(await pending())[0];
  assert.match(b.reason,/\/etc\/hosts/);
  assert.equal((await req("POST",`/v1/approvals/${b.id}/revoke?projectId=shop`,phoneToken,{digest:b.digest})).status,200);
  const denied=JSON.parse((await rejecting).out);
  assert.equal(denied.hookSpecificOutput.decision.behavior,"deny");assert.match(denied.hookSpecificOutput.decision.message,/Rejected/);

  // nobody answers: nothing printed (the terminal asks), and the request leaves the phone
  const t0=Date.now();
  const silent=await runHook({...ask,tool_input:{command:"rm -rf build"}},"10");
  assert.equal(silent.out,"");assert.ok(Date.now()-t0>=9000);
  assert.equal((await pending()).length,0,"withdrawn");

  // LayanX not running / not a permission request: nothing printed, immediately
  const offline=path.join(root,"offline.json");fs.writeFileSync(offline,JSON.stringify({port:1,token:hookToken}));
  assert.equal((await runHook(ask,"20",offline)).out,"");
  assert.equal((await runHook({...ask,hook_event_name:"PreToolUse"})).out,"");
  // a wrong token is refused
  fs.writeFileSync(offline,JSON.stringify({port,token:"lxh_"+"x".repeat(43)}));
  assert.equal((await runHook(ask,"20",offline)).out,"");
  // LayanX accepted the question, then the hook was disconnected (or LayanX is restarting): no busy loop
  let polls=0;const mode={status:403};
  const fake=http.createServer((q,r)=>{if(q.method==="POST"){r.writeHead(201,{"content-type":"application/json"});r.end(JSON.stringify({ok:true,id:"abc"}));return;}polls++;r.writeHead(mode.status,{"content-type":"application/json"});r.end("{}");});
  await new Promise<void>(r=>fake.listen(0,"127.0.0.1",()=>r()));
  fs.writeFileSync(offline,JSON.stringify({port:(fake.address() as {port:number}).port,token:hookToken}));
  const t1=Date.now();assert.equal((await runHook(ask,"20",offline)).out,"");
  assert.ok(Date.now()-t1<3000&&polls===1,"403: stop at once ("+polls+" polls)");
  polls=0;mode.status=503;
  assert.equal((await runHook(ask,"10",offline)).out,"");
  assert.ok(polls<=8,"503: wait between tries ("+polls+" polls in 10 s)");
  fake.close();
}finally{
  await gw.close();api.close();
}
fs.rmSync(root,{recursive:true,force:true});
console.log("agent-hooks: settings backed up and restored, hook asks through LayanX, phone decides with the digest, fail-safe to the terminal");
process.exit(0);
