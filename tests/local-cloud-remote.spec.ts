import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {cloudRoutingForGoal,isComplexGoal} from "../src/config/providers.js";
import {applyCloudSettings} from "../src/local/host.js";
import {DEFAULT_SETTINGS,sanitizeSettings} from "../src/local/settings.js";
import {isTailscaleAddress} from "../src/platform/tailscale.js";
import {AccessManager} from "../src/security/access.js";
import {freeLoopbackPort,startGateway} from "../src/security/local-gateway.js";

const quiet=()=>undefined;

// ---------- cloud settings -> environment
const env:NodeJS.ProcessEnv={ANTHROPIC_API_KEY:"a1",GEMINI_API_KEY:"g1",OPENAI_ENABLED:"false"};
const settings=sanitizeSettings({cloud:{policy:"complex",order:["anthropic","gemini","openai"],models:{anthropic:"claude-opus-5-5"},disabled:{gemini:true}}});
assert.deepEqual(applyCloudSettings(env,settings,quiet),["anthropic"]);
assert.equal(env.LAYANX_AI_MODE,"hybrid");
assert.equal(env.ANTHROPIC_ENABLED,"true");assert.equal(env.ANTHROPIC_MODEL,"claude-opus-5-5");
assert.equal(env.GEMINI_ENABLED,"false","switched off on the setup page");
assert.equal(env.OPENAI_ENABLED,"false","no key, no provider");
assert.equal(env.LAYANX_CLOUD_POLICY,"complex");
const off:NodeJS.ProcessEnv={ANTHROPIC_API_KEY:"x"};
applyCloudSettings(off,sanitizeSettings({cloud:{policy:"off"}}),quiet);
assert.equal(off.LAYANX_AI_MODE,"local");assert.equal(off.ANTHROPIC_ENABLED,"false");
assert.equal(DEFAULT_SETTINGS.cloud.policy,"fallback");

// ---------- which goals go to the cloud
const fakeModels={list:()=>[{id:"claude",provider:"anthropic",local:false,enabled:true,capabilities:["reasoning"],priority:10},{id:"gpt",provider:"openai",local:false,enabled:true,capabilities:["reasoning"],priority:11}] as any};
assert.deepEqual(cloudRoutingForGoal("استخدم كلود لكتابة خطة المشروع",fakeModels,{}),{preferLocal:false,tags:["anthropic"],reason:"named"});
assert.deepEqual(cloudRoutingForGoal("use GPT to review this",fakeModels,{})?.tags,["openai"]);
assert.equal(cloudRoutingForGoal("use gemini",fakeModels,{}),undefined,"gemini not configured: stay local");
assert.equal(cloudRoutingForGoal("صمم معمارية كاملة للتطبيق",fakeModels,{LAYANX_CLOUD_POLICY:"fallback"}),undefined,"fallback policy: complex goals still start local");
assert.equal(cloudRoutingForGoal("صمم معمارية كاملة للتطبيق",fakeModels,{LAYANX_CLOUD_POLICY:"complex"})?.reason,"complex");
assert.equal(isComplexGoal("افتح المتصفح"),false);
assert.equal(isComplexGoal("حلل المشروع ثم أصلح الأخطاء ثم شغّل الاختبارات ثم ارفع التغييرات إلى GitHub"),true);

// ---------- local planning fails -> the same goal is planned by the cloud model
const core=new LayanXCore();
let localCalls=0,cloudCalls=0;
const plan=JSON.stringify({risk:"low",requiredPermission:"L1_READ",steps:[{description:"answer"}],successCriteria:["result exists"],stopCondition:"Stop on policy denial"});
(core as any).providers.register({name:"localfake",async health(){return{provider:"localfake",available:true,updatedAt:new Date().toISOString()};},async generate(model:any){localCalls++;return{modelId:model.id,provider:"localfake",output:"I am a small model and cannot produce JSON"};}});
(core as any).providers.register({name:"cloudfake",async health(){return{provider:"cloudfake",available:true,updatedAt:new Date().toISOString()};},async generate(model:any){cloudCalls++;return{modelId:model.id,provider:"cloudfake",output:cloudCalls===1?plan:"null"};}});
core.models.register({id:"tiny-local",provider:"localfake",capabilities:["chat","reasoning"],local:true,enabled:true,priority:1});
core.models.register({id:"big-cloud",provider:"cloudfake",capabilities:["chat","reasoning"],local:false,enabled:true,priority:10,tags:["anthropic","cloud"]});
const result=await core.runAgentGateway("Create a safe read-only report.","default",1) as any;
assert.ok(localCalls>=1,"local model is tried first");
assert.ok(cloudCalls>=1,"cloud model took over");
assert.equal(result.modelRouting?.reason,"fallback");
assert.ok(core.audit.list().some((e:any)=>e.action==="model.escalate"));

// ---------- remote access: tunnels / tailscale serve arrive from 127.0.0.1 but are treated as REMOTE
assert.equal(isTailscaleAddress("100.101.5.9"),true);
assert.equal(isTailscaleAddress("::ffff:100.64.0.1"),true);
assert.equal(isTailscaleAddress("100.200.0.1"),false);
assert.equal(isTailscaleAddress("192.168.1.5"),false);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-remote-"));
const access=new AccessManager({devicesFile:path.join(dir,"d.json"),launchTicketFile:path.join(dir,"t.json"),masterToken:"lxm_remote_master"});
const upstreamPort=await freeLoopbackPort();
const upstream=http.createServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({principal:req.headers["x-layanx-principal"]}));});
await new Promise<void>(r=>upstream.listen(upstreamPort,"127.0.0.1",()=>r()));
const call=(port:number,host:string,headers:Record<string,string>={})=>new Promise<{status:number;body:any}>((resolve,reject)=>{
  const req=http.request({host:"127.0.0.1",port,path:"/x",headers:{host,...headers}},res=>{let t="";res.on("data",c=>t+=c);res.on("end",()=>{let body:any=null;try{body=JSON.parse(t);}catch{}resolve({status:res.statusCode??0,body});});});
  req.on("error",reject);req.end();
});
const p1=await freeLoopbackPort(),p2=await freeLoopbackPort();
const route=async()=>false;
const on=await startGateway({bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:p1,internalPort:upstreamPort}],access,internalToken:"i",mobileAccess:false,remoteAccess:true,remoteHosts:["layanx.example.com"],log:quiet,handleOwnRoute:route});
const offGw=await startGateway({bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:p2,internalPort:upstreamPort}],access,internalToken:"i",mobileAccess:false,remoteAccess:false,log:quiet,handleOwnRoute:route});
try{
  access.issueLaunchTicket();
  const session=access.exchangeLaunchTicket(JSON.parse(fs.readFileSync(path.join(dir,"t.json"),"utf8")).code)!;
  const paired=access.completePairing(access.startPairing().code,"phone","1.1.1.1");
  if(!paired.ok)throw new Error("pairing failed");
  const bearer={authorization:"Bearer "+paired.deviceToken};
  assert.equal((await call(p1,"localhost:"+p1,{cookie:"layanx_session="+session})).status,200,"local browser still works");
  assert.equal((await call(p1,"layanx.example.com",{cookie:"layanx_session="+session})).status,401,"a browser session never works through a tunnel");
  assert.equal((await call(p1,"layanx.example.com",{authorization:"Bearer lxm_remote_master"})).status,403,"master token is never accepted remotely");
  const viaTunnel=await call(p1,"layanx.example.com",bearer);
  assert.equal(viaTunnel.status,200);assert.match(viaTunnel.body.principal,/^device:/);
  assert.equal((await call(p1,"my-pc.tail1234.ts.net",bearer)).status,200,"tailscale serve hostname");
  assert.equal((await call(p1,"evil.example.org",bearer)).status,421,"unknown hostnames are refused");
  assert.equal((await call(p2,"my-pc.tail1234.ts.net",bearer)).status,403,"remote access off");
}finally{await on.close();await offGw.close();upstream.close();}

console.log("local-cloud-remote: all assertions passed");
