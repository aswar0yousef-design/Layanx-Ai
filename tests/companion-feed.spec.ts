import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-companion-"));
const {startRuntimeApi}=await import("../src/api-server.js");
const {LayanXCore}=await import("../src/core/orchestrator.js");
const {runSingleTool}=await import("../src/autonomy/runtime-deps.js");
const {ApprovalEngine,approvalDigest}=await import("../src/security/approval.js");
const {Supervisor}=await import("../src/autonomy/supervisor.js");

// ---------- the approval engine: rejected requests stop waiting, and survive a restart ----------
{
  const e=new ApprovalEngine();
  const r=e.create({missionId:"m",agentId:"core",tool:"t",action:"a",permission:"L4_EXECUTE",payloadHash:"h",reason:"why",expiresAt:new Date(Date.now()+60_000).toISOString()});
  e.revoke(r.id);
  assert.equal(e.isRejected(r.id),true);
  assert.equal(e.findPending({missionId:"m",agentId:"core",tool:"t",action:"a",permission:"L4_EXECUTE",payloadHash:"h"}),undefined,"a rejected request is not reused: the agent asks again with a new one");
  const copy=new ApprovalEngine();copy.restore(e.snapshot());
  assert.equal(copy.isRejected(r.id),true,"persisted");
  e.approve(r.id);
  assert.equal(e.isRejected(r.id),false,"the owner can still approve later");
  const other={...r,reason:"something else"};
  assert.notEqual(approvalDigest(r),approvalDigest(other),"the digest covers what the owner reads");
  assert.notEqual(approvalDigest(r),approvalDigest({...r,payloadHash:"h2"}),"and what would run");
}

// ---------- the API: digest-bound decisions, continuation on the PC, the feed ----------
const core=new LayanXCore();
let ran=0;
core.registerAgent({agentId:"core",purpose:"test",allowedTools:["test.danger"],forbiddenResources:["secrets"],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"test.danger",description:"a dangerous test action",permission:"L4_EXECUTE",dangerous:true,actions:["do danger"],tags:["test"]});
core.toolAdapters.register("test.danger",{async execute(){ran++;return{done:true};}});

const server=startRuntimeApi({core,host:"127.0.0.1",port:0});await new Promise<void>(resolve=>server.on("listening",resolve));
const address=server.address();if(!address||typeof address==="string")throw new Error("bind failed");
const base="http://127.0.0.1:"+address.port;
const phone={"x-layanx-principal":"device:dev_000000000001"};
const get=async(p:string)=>{const r=await fetch(base+p);return{status:r.status,json:await r.json() as any};};
const post=async(p:string,body:unknown,headers:Record<string,string>={})=>{const r=await fetch(base+p,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});return{status:r.status,json:await r.json() as any};};
const until=async(f:()=>boolean|Promise<boolean>,ms=8000)=>{const end=Date.now()+ms;while(!await f()){if(Date.now()>end)throw new Error("timeout");await new Promise(r=>setTimeout(r,25));}};

try{
  const first=await runSingleTool(core,"shop","test.danger",{x:1});
  assert.equal(first.ok,false);assert.ok(first.approvalId,"a dangerous tool waits for the owner");
  const listed=(await get("/v1/approvals?projectId=shop")).json.approvals as any[];
  const a=listed.find(x=>x.id===first.approvalId);
  assert.ok(a&&a.pending&&!a.rejected&&a.projectId==="shop");
  assert.match(a.digest,/^[A-Za-z0-9_-]{43}$/);

  // the feed: every project, pending only, a cursor that changes with what the phone shows
  const feed1=(await get("/v1/companion/feed?load=0")).json;
  assert.equal(feed1.ok,true);
  assert.deepEqual(feed1.approvals.map((x:any)=>x.id),[first.approvalId]);
  assert.equal(feed1.load,undefined);
  assert.ok(Array.isArray(feed1.jobs));
  const t0=Date.now();
  const same=(await get(`/v1/companion/feed?cursor=${feed1.cursor}&wait=1&load=0`)).json;
  assert.equal(same.cursor,feed1.cursor);assert.ok(Date.now()-t0>=900,"long poll waits while nothing changes");

  // phones must send the digest of what they showed
  const url=`/v1/approvals/${first.approvalId}/approve?projectId=shop`;
  assert.equal((await post(url,{resume:true},phone)).status,428);
  const changed=await post(url,{digest:"x".repeat(43),resume:true},phone);
  assert.equal(changed.status,409);assert.equal(changed.json.error,"approval_changed");
  assert.equal(ran,0,"nothing ran on a refused decision");

  // a waiting long poll wakes up when the approval is decided
  const waiting=get(`/v1/companion/feed?cursor=${feed1.cursor}&wait=10&load=0`);
  await new Promise(r=>setTimeout(r,300));
  const ok=await post(url,{digest:a.digest,resume:true},phone);
  assert.equal(ok.status,200,JSON.stringify(ok.json));
  assert.equal(ok.json.continuing,"tool","the PC carries on by itself");
  await until(()=>ran===1);
  const woke=(await waiting).json;
  assert.notEqual(woke.cursor,feed1.cursor);assert.equal(woke.approvals.length,0);
  // approving again (notification + app) never runs it twice
  const again=await post(url,{digest:a.digest,resume:true},phone);
  assert.equal(again.json.continuing,null);
  await new Promise(r=>setTimeout(r,200));assert.equal(ran,1);

  // rejecting: no longer pending anywhere
  const second=await runSingleTool(core,"shop","test.danger",{x:2});
  const b=((await get("/v1/approvals?projectId=shop")).json.approvals as any[]).find(x=>x.id===second.approvalId);
  const no=await post(`/v1/approvals/${second.approvalId}/revoke?projectId=shop`,{digest:b.digest},phone);
  assert.equal(no.status,200);assert.equal(no.json.approval.rejected,true);assert.equal(no.json.approval.pending,false);
  assert.equal((await get("/v1/companion/feed?load=0")).json.approvals.length,0);
  assert.equal(ran,1);

  // the owner on this PC (no device principal) keeps the old behaviour: no digest needed, no resume unless asked
  const third=await runSingleTool(core,"shop","test.danger",{x:3});
  const owner=await post(`/v1/approvals/${third.approvalId}/approve?projectId=shop`,{});
  assert.equal(owner.status,200);assert.equal(owner.json.continuing,null);
  await new Promise(r=>setTimeout(r,200));assert.equal(ran,1,"the web page resumes it itself");
  // the older mission-scoped approve route follows the same rules (no way around the digest)
  const legacy=await runSingleTool(core,"shop","test.danger",{x:4});
  assert.equal((await post(`/v1/missions/${legacy.missionId}/approvals/${legacy.approvalId}/approve`,{},phone)).status,428);
  assert.equal((await post(`/v1/missions/${legacy.missionId}/approvals/${legacy.approvalId}/approve`,{})).status,200,"the owner on this PC");
  // project isolation still applies
  assert.equal((await post(`/v1/approvals/${third.approvalId}/revoke?projectId=other`,{})).status,422);

  // with the load figures (CPU/RAM) for the widget
  const loaded=(await get("/v1/companion/feed")).json;
  assert.equal(typeof loaded.load?.cpu?.percent,"number");
  assert.equal(typeof loaded.load?.memory?.percent,"number");
}finally{server.close();}

// ---------- a job whose approval the owner rejects stops instead of waiting forever ----------
{
  const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-sup-reject-"));
  process.env.LAYANX_WORKSPACE_ROOT=store;fs.mkdirSync(path.join(store,"shop",".git"),{recursive:true});
  let rejected=false;
  const sup=new Supervisor({
    async think(){return "```json\n"+JSON.stringify({acceptance:["x"],milestones:[{title:"Do it",goal:"do it",kind:"general"}],checks:{}})+"\n```";},
    async runAgent(){return{paused:true,missionId:"m1",approvalId:"ap-x",nextToolIndex:0};},
    async resumeAgent(){return{completed:true};},
    async runTool(){return{ok:true,data:{ok:true,exitCode:0}};},
    isApproved:()=>false,isRejected:id=>rejected&&id==="ap-x",
    cloudAvailable:()=>false,externalAgent:()=>null,
    detect:()=>({dir:path.join(store,"shop"),stack:"unknown" as never,packageManager:"npm" as never,scripts:[],hasLockfile:false,git:true,tasks:[]})
  },{file:path.join(store,"jobs.json"),pollMs:5});
  const job=sup.create("do the thing","shop");
  await until(()=>sup.get(job.id)!.status==="waiting_approval");
  rejected=true;
  await until(()=>sup.get(job.id)!.status==="cancelled");
  assert.match(sup.get(job.id)!.result??"",/rejected/);
}

console.log("companion-feed: digest-bound phone decisions, continuation on the PC, rejection, long-poll feed");
process.exit(0);
