import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {openSecretStore} from "../src/security/secret-store.js";
import {AccessManager} from "../src/security/access.js";
import {freeLoopbackPort,startGateway} from "../src/security/local-gateway.js";
import {GB,startMockOllama} from "./fixtures/mock-ollama.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"..");

interface Reply{status:number;headers:http.IncomingHttpHeaders;text:string;json:any}
function call(port:number,method:string,urlPath:string,headers:Record<string,string>={},body?:unknown):Promise<Reply>{
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const r=http.request({host:"127.0.0.1",port,method,path:urlPath,headers:{...(payload?{"content-type":"application/json","content-length":String(Buffer.byteLength(payload))}:{}),...headers}},res=>{
      let text="";res.setEncoding("utf8");res.on("data",c=>{text+=c;});
      res.on("end",()=>{let json:any=null;try{json=JSON.parse(text);}catch{}resolve({status:res.statusCode??0,headers:res.headers,text,json});});
    });
    r.on("error",reject);
    if(payload)r.write(payload);
    r.end();
  });
}
async function waitFor(check:()=>Promise<boolean>,ms=30_000){
  const end=Date.now()+ms;
  while(Date.now()<end){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,250));}
  throw new Error("timed out");
}

// ======================================================================
// Part 1: full host as the launcher starts it (child process, real ports)
// ======================================================================
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-host-"));
const preStore=await openSecretStore(dataDir,{backend:"file"});
await preStore.set("TEST_SECRET","value-from-store");
const ollama=await startMockOllama([
  {name:"qwen2.5:7b",size:4.7*GB,parameter_size:"7.6B",capabilities:["completion","tools"],context:32768},
  {name:"llava:7b",size:4.7*GB,parameter_size:"7B",capabilities:["completion","vision"],context:4096}
]);
const publicPort=await freeLoopbackPort();
const flowPort=await freeLoopbackPort();
const env={
  ...process.env,
  LAYANX_DATA_DIR:dataDir,LAYANX_SECRET_BACKEND:"file",OLLAMA_BASE_URL:ollama.url,
  OLLAMA_MODEL:"llama3.2:3b",                         // stale value copied from .env.example: not installed
  LAYANX_PUBLIC_PORT:String(publicPort),LAYANX_FLOW_PUBLIC_PORT:String(flowPort),
  LAYANX_API_ENTRY:path.join(here,"fixtures","mock-api.ts")
};
const host=spawn(process.execPath,[path.join(repo,"node_modules","tsx","dist","cli.mjs"),path.join(repo,"src","start-local.ts")],{cwd:repo,env,stdio:["ignore","pipe","pipe"]});
let hostLog="";
host.stdout.on("data",d=>{hostLog+=d;});host.stderr.on("data",d=>{hostLog+=d;});

try{
  await waitFor(async()=>(await call(publicPort,"GET","/v1/gateway/health")).json?.app==="layanx-gateway");
  await waitFor(async()=>hostLog.includes("ready:"));

  // nothing works without a session
  assert.equal((await call(publicPort,"GET","/v1/setup/status")).status,401);
  const locked=await call(publicPort,"GET","/",{accept:"text/html"});
  assert.equal(locked.status,401);
  assert.match(locked.text,/افتح LayanX من الاختصار/);
  assert.equal((await call(publicPort,"GET","/anything")).status,401,"legacy API is not reachable without auth");

  // DNS rebinding: a foreign Host header is refused even from this computer
  assert.equal((await call(publicPort,"GET","/v1/gateway/health",{host:"attacker.example:"+publicPort})).status,421);

  // launcher flow: ticket file -> session cookie
  assert.equal((await call(publicPort,"POST","/v1/setup/launch-ticket",{},{})).status,200);
  const ticket=JSON.parse(fs.readFileSync(path.join(dataDir,"launch-ticket.json"),"utf8")) as {code:string};
  const launched=await call(publicPort,"POST","/v1/session/launch",{},{code:ticket.code});
  assert.equal(launched.status,200);
  const setCookie=String(launched.headers["set-cookie"]);
  assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
  const cookie=setCookie.split(";")[0]!+"; theme=dark";
  assert.equal((await call(publicPort,"POST","/v1/session/launch",{},{code:ticket.code})).status,401,"ticket is single-use");

  const page=await call(publicPort,"GET","/setup");
  assert.equal(page.status,200);
  assert.match(String(page.headers["content-security-policy"]),/frame-ancestors 'none'/);

  const status=await call(publicPort,"GET","/v1/setup/status",{cookie});
  assert.equal(status.status,200);
  assert.equal(status.json.ollama.reachable,true);
  assert.equal(status.json.ollama.plan.assignments.vision,"llava:7b");
  assert.equal(status.json.appliedModels.OLLAMA_MODEL,"qwen2.5:7b","stale OLLAMA_MODEL replaced by an installed model");
  assert.ok(status.json.secrets.names.some((n:any)=>n.name==="LAYANX_API_TOKEN"&&n.system));
  assert.ok(!status.text.includes("value-from-store"),"secret values are never returned");
  assert.equal(status.json.runtime.state,"running");

  // proxied request: token injected, session cookie stripped, secrets and models in env
  const origin=`http://127.0.0.1:${publicPort}`;
  const echo=await call(publicPort,"GET","/hello?x=1",{cookie});
  assert.equal(echo.status,200);
  assert.equal(echo.json.name,"api");
  assert.equal(echo.json.path,"/hello?x=1");
  assert.equal(echo.json.headers.authorization,"present");
  assert.equal(echo.json.headers.cookie,"theme=dark","LayanX session cookie never reaches the runtime");
  assert.equal(echo.json.headers.principal,"owner");
  assert.equal(echo.json.env.TEST_SECRET,"loaded");
  assert.equal(echo.json.env.OLLAMA_MODEL,"qwen2.5:7b");
  assert.ok(String(echo.json.env.BUSINESS).startsWith(dataDir),"stores moved to the per-user data dir");

  // CSRF: unsafe requests need a trusted Origin; foreign origins are refused
  assert.equal((await call(publicPort,"POST","/v1/missions",{cookie},{goal:"x"})).status,403);
  assert.equal((await call(publicPort,"POST","/v1/missions",{cookie,origin:"https://evil.example"},{goal:"x"})).status,403);
  assert.equal((await call(publicPort,"GET","/hello",{cookie,"sec-fetch-site":"cross-site"})).status,403);
  const post=await call(publicPort,"POST","/v1/missions",{cookie,origin},{goal:"x"});
  assert.equal(post.status,200);
  assert.equal(post.json.headers.origin,null,"Origin is removed after validation");
  assert.equal(post.json.body,'{"goal":"x"}');
  const pre=await call(publicPort,"OPTIONS","/v1/missions",{origin:"https://evil.example","access-control-request-method":"POST","access-control-request-private-network":"true"});
  assert.equal(pre.status,403);

  // Flow Builder listener is protected the same way
  assert.equal((await call(flowPort,"GET","/flow")).status,401);
  assert.equal((await call(flowPort,"GET","/flow",{cookie})).json.name,"flow");

  // master token (local CLI) works from loopback
  const master=(await openSecretStore(dataDir,{backend:"file"})).get("LAYANX_API_TOKEN")!;
  assert.equal((await call(publicPort,"GET","/hello",{authorization:"Bearer "+master})).status,200);

  // secrets + settings from the setup page
  assert.equal((await call(publicPort,"PUT","/v1/setup/secrets",{cookie,origin},{name:"OPENAI_API_KEY",value:"sk-ui"})).status,200);
  assert.equal((await call(publicPort,"PUT","/v1/setup/secrets",{cookie,origin},{name:"LAYANX_API_TOKEN",value:"x"})).status,400,"system secrets are not editable");
  assert.equal((await call(publicPort,"PUT","/v1/setup/settings",{cookie,origin},{capabilities:{trading:false}})).status,200);
  assert.equal((await call(publicPort,"GET","/v1/setup/status",{cookie})).json.restartRequired,true);

  // pairing a phone (over loopback here; LAN behaviour is covered in part 2)
  const pairing=await call(publicPort,"POST","/v1/pair/start",{cookie,origin},{});
  assert.equal(pairing.status,200);
  const paired=await call(publicPort,"POST","/v1/pair/complete",{},{code:pairing.json.code,deviceName:"Pixel"});
  assert.equal(paired.status,200);
  const deviceAuth={authorization:"Bearer "+paired.json.deviceToken};
  assert.equal((await call(publicPort,"GET","/v1/device/whoami",deviceAuth)).json.name,"Pixel");
  const viaPhone=await call(publicPort,"GET","/hello",deviceAuth);
  assert.match(viaPhone.json.headers.principal,/^device:dev_/);
  assert.equal((await call(publicPort,"GET","/v1/setup/status",deviceAuth)).status,403,"phones cannot read or change secrets");

  // WebSocket upgrade goes through the same gate
  const ws=await new Promise<string>((resolve,reject)=>{
    const sock=net.connect(publicPort,"127.0.0.1",()=>{
      sock.write(`GET /v1/events HTTP/1.1\r\nHost: 127.0.0.1:${publicPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nCookie: ${cookie}\r\nOrigin: ${origin}\r\n\r\n`);
    });
    let buf="";
    sock.on("data",d=>{buf+=d;if(buf.includes("\r\n\r\n")&&!buf.includes("ping")){sock.write("ping");}if(buf.includes("ping")){sock.destroy();resolve(buf);}});
    sock.on("error",reject);setTimeout(()=>reject(new Error("ws timeout")),5000);
  });
  assert.match(ws,/101 Switching Protocols/);assert.match(ws,/X-Principal: owner/);
  const wsDenied=await new Promise<string>(resolve=>{
    const sock=net.connect(publicPort,"127.0.0.1",()=>sock.write(`GET /v1/events HTTP/1.1\r\nHost: 127.0.0.1:${publicPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`));
    let buf="";sock.on("data",d=>{buf+=d;});sock.on("close",()=>resolve(buf));
  });
  assert.match(wsDenied,/401/);

  const devices=await call(publicPort,"GET","/v1/pair/devices",{cookie});
  assert.equal((await call(publicPort,"DELETE","/v1/pair/devices/"+devices.json.devices[0].id,{cookie,origin})).status,200);
  assert.equal((await call(publicPort,"GET","/hello",deviceAuth)).status,403,"revoked phone is locked out");

  // in-place restart keeps the owner signed in
  const pidBefore=fs.readFileSync(path.join(dataDir,"layanx.pid"),"utf8");
  assert.equal((await call(publicPort,"POST","/v1/setup/restart",{cookie,origin},{})).status,200);
  await waitFor(async()=>{
    const pid=fs.existsSync(path.join(dataDir,"layanx.pid"))?fs.readFileSync(path.join(dataDir,"layanx.pid"),"utf8"):pidBefore;
    return pid!==pidBefore&&(await call(publicPort,"GET","/v1/setup/status",{cookie})).status===200;
  });
  const afterRestart=await call(publicPort,"GET","/v1/setup/status",{cookie});
  assert.equal(afterRestart.json.capabilities.trading.enabled,false);
  assert.equal(afterRestart.json.restartRequired,false);
  await waitFor(async()=>(await call(publicPort,"GET","/hello",{cookie})).json?.env?.LAYANX_CAPABILITIES?.includes("coding")===true);
  assert.ok(!(await call(publicPort,"GET","/hello",{cookie})).json.env.LAYANX_CAPABILITIES.includes("trading"));

  assert.equal((await call(publicPort,"POST","/v1/setup/shutdown",{cookie,origin},{})).status,200);
  await waitFor(async()=>{try{await call(publicPort,"GET","/v1/gateway/health");return false;}catch{return true;}},10_000);
  assert.ok(!fs.existsSync(path.join(dataDir,"layanx.pid")),"pid file removed on shutdown");
}catch(error){
  console.error(hostLog.slice(-4000));
  throw error;
}finally{
  host.kill();
  try{const pid=Number(fs.readFileSync(path.join(dataDir,"layanx.pid"),"utf8"));if(pid)process.kill(pid);}catch{}
  await ollama.close();
}

// ======================================================================
// Part 2: LAN rules (simulated remote address, in-process gateway)
// ======================================================================
const lanDir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-lan-"));
const access=new AccessManager({devicesFile:path.join(lanDir,"d.json"),launchTicketFile:path.join(lanDir,"t.json"),masterToken:"lxm_lan_master"});
const upstreamPort=await freeLoopbackPort();
const upstream=http.createServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({principal:req.headers["x-layanx-principal"]}));});
await new Promise<void>(r=>upstream.listen(upstreamPort,"127.0.0.1",()=>r()));
const lanPort=await freeLoopbackPort();
const {createSetupRoutes}=await import("../src/local/setup-routes.js");
let remoteIsLan=true;
const gw=await startGateway({
  bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:lanPort,internalPort:upstreamPort}],access,internalToken:"internal",mobileAccess:true,
  isLoopback:()=>!remoteIsLan,localAddresses:()=>["127.0.0.1"],log:()=>undefined,
  handleOwnRoute:async ctx=>{
    if(ctx.url.pathname==="/v1/pair/complete"){
      const body=await ctx.readJson() as {code?:string};
      const r=access.completePairing(body.code,"lan-phone",ctx.remoteAddress);
      ctx.sendJson(r.ok?200:r.status,r);return true;
    }
    if(ctx.url.pathname==="/setup"){ctx.sendJson(ctx.loopback?200:404,{});return true;}
    return false;
  }
});
try{
  void createSetupRoutes;
  access.issueLaunchTicket();
  const t=JSON.parse(fs.readFileSync(path.join(lanDir,"t.json"),"utf8")) as {code:string};
  const session=access.exchangeLaunchTicket(t.code)!;
  assert.equal((await call(lanPort,"GET","/x",{cookie:"layanx_session="+session})).status,401,"browser sessions do not work from the LAN");
  assert.equal((await call(lanPort,"GET","/x",{authorization:"Bearer lxm_lan_master"})).status,403,"master token is loopback-only");
  assert.equal((await call(lanPort,"GET","/setup")).status,404,"setup page is not served to the LAN");
  const code=access.startPairing().code;
  const paired=await call(lanPort,"POST","/v1/pair/complete",{},{code});
  assert.equal(paired.status,200);
  const ok=await call(lanPort,"GET","/x",{authorization:"Bearer "+paired.json.deviceToken,origin:"capacitor://localhost"});
  assert.equal(ok.status,200);
  assert.match(ok.json.principal,/^device:/);
  assert.equal(ok.headers["access-control-allow-origin"],"capacitor://localhost");
  assert.equal(ok.headers["access-control-allow-credentials"],undefined,"no credentialed CORS for token clients");
  remoteIsLan=false;
}finally{
  await gw.close();
  await new Promise<void>(r=>upstream.close(()=>r()));
}

// mobile access off -> LAN refused outright
const offPort=await freeLoopbackPort();
const off=await startGateway({bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:offPort,internalPort:upstreamPort}],access,internalToken:"i",mobileAccess:false,isLoopback:()=>false,log:()=>undefined,handleOwnRoute:async()=>false});
try{assert.equal((await call(offPort,"GET","/x")).status,403);}finally{await off.close();}

console.log("local-gateway: all assertions passed");
