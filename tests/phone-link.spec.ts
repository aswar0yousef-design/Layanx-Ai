import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {execFileSync,spawn,spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {AccessManager} from "../src/security/access.js";
import {startGateway} from "../src/security/local-gateway.js";
import {createLinkRoutes} from "../src/security/link-routes.js";
import {LinkIdentity,PAIR_AAD,PAIR_OK_AAD,b64u,open,pairKey,pairingUri,requestAad,responseAad,seal,sessionKeys} from "../src/security/phone-link.js";
import {qrModules,qrSvg} from "../src/platform/qr.js";

// The encrypted phone link (v2): pairing from the QR code, every request sealed with AES-256-GCM, no
// replay, answers bound to their request, and the same protocol in the phone's Java code.
const root=fileURLToPath(new URL("..",import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-link-"));
const freePort=()=>new Promise<number>(r=>{const s=http.createServer();s.listen(0,"127.0.0.1",()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});});
const post=(port:number,p:string,body:unknown,headers:Record<string,string>={})=>new Promise<{status:number;json:any}>((resolve,reject)=>{
  const data=Buffer.from(JSON.stringify(body));
  const req=http.request({host:"127.0.0.1",port,method:"POST",path:p,headers:{"content-type":"application/json","content-length":String(data.length),...headers}},res=>{
    const c:Buffer[]=[];res.on("data",x=>c.push(x));res.on("end",()=>{const t=Buffer.concat(c).toString("utf8");resolve({status:res.statusCode??0,json:t?JSON.parse(t):null});});
  });req.on("error",reject);req.end(data);
});

// The runtime stand-in: echoes who is asking and what was sent.
const seen:Array<{principal:string;path:string;type:string;body:string}>=[];
const upstream=http.createServer((req,res)=>{const c:Buffer[]=[];req.on("data",x=>c.push(x));req.on("end",()=>{
  const body=Buffer.concat(c);
  seen.push({principal:String(req.headers["x-layanx-principal"]),path:String(req.url),type:String(req.headers["content-type"]??""),body:body.toString("utf8")});
  if(req.url==="/v1/echo-binary"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({bytes:[...body]}));return;}
  if(req.url==="/v1/png"){res.writeHead(200,{"content-type":"image/png"});res.end(Buffer.from([137,80,78,71]));return;}
  res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({principal:req.headers["x-layanx-principal"],path:req.url,body:body.length?JSON.parse(body.toString("utf8")):null}));
});});
const upstreamPort=await freePort();await new Promise<void>(r=>upstream.listen(upstreamPort,"127.0.0.1",()=>r()));

const access=new AccessManager({devicesFile:path.join(dir,"devices.json"),launchTicketFile:path.join(dir,"t.json"),masterToken:"lxm_master"});
const identity=new LinkIdentity(crypto.randomBytes(32).toString("base64url"));
const link=createLinkRoutes({access,identity,installId:"lx-test0000000000",computer:"PC-اختبار",addresses:async()=>["http://192.168.1.20:8787"],internalToken:"internal"});
const port=await freePort();
const gw=await startGateway({bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:port,internalPort:upstreamPort}],access,internalToken:"internal",mobileAccess:true,
  // Every request looks like it comes from another device on the home Wi-Fi (plain HTTP).
  isLoopback:()=>false,localAddresses:()=>["127.0.0.1"],log:()=>undefined,
  handleOwnRoute:async ctx=>ctx.url.pathname.startsWith("/v1/link")?link(ctx):false});
const base=`http://127.0.0.1:${port}`;

// A phone in TypeScript (the Android app runs the same protocol in Java, checked at the end).
function phone(){
  const ecdh=crypto.createECDH("prime256v1");ecdh.generateKeys();
  return{ecdh,pub:ecdh.getPublicKey()};
}
async function pair(code:string,pcKey:Buffer,p=phone()){
  const key=pairKey(p.ecdh.computeSecret(pcKey),p.pub,pcKey);
  const r=await post(port,"/v1/link/pair",{v:2,pk:b64u.enc(p.pub),...seal(key,JSON.stringify({code,name:"هاتف"}),PAIR_AAD)});
  return{r,key,p};
}
function envelope(deviceId:string,p:ReturnType<typeof phone>,inner:Record<string,unknown>){
  const k=sessionKeys(p.ecdh.computeSecret(identity.publicKey),deviceId);
  const r=crypto.randomBytes(18).toString("base64url");
  return{k,r,body:{v:2,d:deviceId,...seal(k.c2s,JSON.stringify({t:Date.now(),r,...inner}),requestAad(deviceId))}};
}

try{
  // 1. The QR code: the link with this PC's public key, as an SVG image.
  const code=access.startPairing().code;
  const uri=pairingUri({publicKey:identity.publicKey,code,computer:"PC-اختبار",urls:[base,"http://100.101.1.2:8787"]});
  assert.match(uri,/^layanx:\/\/pair\?v=2&k=[A-Za-z0-9_-]{87}&c=[A-Z0-9-]{9}&n=PC-%D8/);
  const modules=qrModules(uri);assert.ok(modules.length>=21&&modules.length===modules[0]!.length,"square QR matrix");
  assert.deepEqual(qrModules(uri),modules,"deterministic");
  assert.match(qrSvg(uri),/^<svg [^>]*viewBox="0 0 \d+ \d+"[\s\S]*<path d="M/);
  assert.throws(()=>qrModules("غير ASCII"),/printable ASCII/);

  // 2. Pairing: a wrong code is refused; the right one gives a device and an answer only this PC can write.
  assert.equal((await pair("AAAA-AAAA",identity.publicKey)).r.status,401);
  const ok=await pair(code,identity.publicKey);
  assert.equal(ok.r.status,200,JSON.stringify(ok.r.json));
  const reply=JSON.parse(open(ok.key,ok.r.json,PAIR_OK_AAD).toString("utf8"));
  assert.match(reply.deviceId,/^dev_[a-f0-9]{12}$/);assert.equal(reply.computer,"PC-اختبار");assert.deepEqual(reply.addresses,["http://192.168.1.20:8787"]);
  assert.equal((await pair(code,identity.publicKey)).r.status,410,"a code works once");
  assert.equal(access.listDevices().find(d=>d.id===reply.deviceId)!.name,"هاتف");
  assert.equal(JSON.stringify(access.listDevices()).includes("linkKey"),false,"the phone's key is not listed");
  // Someone on the Wi-Fi who swaps in their own key cannot read the code: the request is sealed to the PC's key.
  const intruder=phone();const fakePc=phone();
  const code2=access.startPairing().code;
  const sealedForOther=pairKey(intruder.ecdh.computeSecret(fakePc.pub),intruder.pub,fakePc.pub);
  assert.equal((await post(port,"/v1/link/pair",{v:2,pk:b64u.enc(intruder.pub),...seal(sealedForOther,JSON.stringify({code:code2,name:"x"}),PAIR_AAD)})).status,400,"sealed to another key: unreadable");
  access.cancelPairing();

  // 3. Requests: forwarded as the device, body and answer encrypted, the answer bound to the request.
  const dev=reply.deviceId as string;
  const e1=envelope(dev,ok.p,{m:"POST",p:"/v1/echo?x=1",b:JSON.stringify({text:"مرحبا"})});
  const a1=await post(port,"/v1/link",e1.body);
  assert.equal(a1.status,200);
  assert.equal(JSON.stringify(a1.json).includes("مرحبا"),false,"nothing readable on the wire");
  const inner1=JSON.parse(open(e1.k.s2c,a1.json,responseAad(dev,e1.r)).toString("utf8"));
  assert.equal(inner1.s,200);
  assert.deepEqual(JSON.parse(inner1.b),{principal:`device:${dev}`,path:"/v1/echo?x=1",body:{text:"مرحبا"}});
  assert.throws(()=>open(e1.k.s2c,a1.json,responseAad(dev,"another-request-id-0000")),"an answer cannot be passed off as another request's");
  // Binary both ways (a voice clip up, an image down).
  const e2=envelope(dev,ok.p,{m:"POST",p:"/v1/echo-binary",b:Buffer.from([0,1,2,3,4]).toString("base64"),bt:"audio/wav",b64:true});
  const inner2=JSON.parse(open(e2.k.s2c,(await post(port,"/v1/link",e2.body)).json,responseAad(dev,e2.r)).toString("utf8"));
  assert.deepEqual(JSON.parse(inner2.b).bytes,[0,1,2,3,4]);assert.equal(seen.at(-1)!.type,"audio/wav");
  const e3=envelope(dev,ok.p,{m:"GET",p:"/v1/png"});
  const inner3=JSON.parse(open(e3.k.s2c,(await post(port,"/v1/link",e3.body)).json,responseAad(dev,e3.r)).toString("utf8"));
  assert.deepEqual({b64:inner3.b64,bytes:[...Buffer.from(inner3.b,"base64")]},{b64:true,bytes:[137,80,78,71]});

  // 4. Refused: a replay, a changed byte, an old timestamp, a path outside /v1, an unknown or removed phone.
  assert.equal((await post(port,"/v1/link",e1.body)).status,409,"the same request twice");
  const flipped={...e3.body,c:e3.body.c.slice(0,-2)+(e3.body.c.endsWith("A")?"BA":"AA")};
  assert.equal((await post(port,"/v1/link",flipped)).status,400,"a changed ciphertext");
  const old=envelope(dev,ok.p,{m:"GET",p:"/v1/x",t:Date.now()-10*60_000});
  assert.equal((await post(port,"/v1/link",old.body)).status,409,"10 minutes old");
  for(const p of ["/setup","/v1/../setup","https://evil/v1/x"]){
    const bad=envelope(dev,ok.p,{m:"GET",p});assert.equal((await post(port,"/v1/link",bad.body)).status,400,p);
  }
  const other=phone();
  const stranger=envelope(dev,other,{m:"GET",p:"/v1/x"});
  assert.equal((await post(port,"/v1/link",stranger.body)).status,400,"another phone's key cannot speak for this device");
  assert.equal((await post(port,"/v1/link",{...e1.body,d:"dev_000000000000"})).status,401);
  const before=seen.length;

  // 5. The old link (bearer token) over plain Wi-Fi is refused: the token would travel in clear.
  const legacyCode=access.startPairing().code;
  const legacy=access.completePairing(legacyCode,"old phone","test");
  assert.ok(legacy.ok);
  const plain=await new Promise<{status:number;json:any}>((resolve,reject)=>{http.get({host:"127.0.0.1",port,path:"/v1/x",headers:{authorization:"Bearer "+(legacy as {deviceToken:string}).deviceToken}},res=>{const c:Buffer[]=[];res.on("data",x=>c.push(x));res.on("end",()=>resolve({status:res.statusCode??0,json:JSON.parse(Buffer.concat(c).toString("utf8"))}));}).on("error",reject);});
  assert.equal(plain.status,403);assert.match(plain.json.message,/old unencrypted link.*pair it again/);
  assert.equal(seen.length,before,"nothing reached the runtime");

  // 6. Removing the phone on the PC ends its link at once.
  assert.ok(access.revokeDevice(dev));
  assert.equal((await post(port,"/v1/link",envelope(dev,ok.p,{m:"GET",p:"/v1/x"}).body)).status,401);

  // 7. The phone's Java code (shipped in the Android app) against this gateway.
  let javac=false;try{execFileSync("javac",["-version"],{stdio:"ignore"});javac=true;}catch{}
  if(javac){
    const out=path.join(dir,"classes");fs.mkdirSync(out);
    const src=path.join(root,"mobile","modules","layanx-native","android","src","main","java","expo","modules","layanxnative");
    const files=["LinkCrypto.java","LinkClient.java","MiniJson.java"].map(f=>path.join(src,f));
    const c=spawnSync("javac",["-encoding","UTF-8","-d",out,...files,path.join(root,"tests","fixtures","java","LinkCheck.java")],{encoding:"utf8"});
    assert.equal(c.status,0,"javac: "+c.stderr);
    const javaCode=access.startPairing().code;
    const javaUri=pairingUri({publicKey:identity.publicKey,code:javaCode,computer:"PC-اختبار",urls:["http://127.0.0.1:1",base]});
    // Not spawnSync: the gateway runs in this process and must keep answering.
    const r=await new Promise<{status:number|null;stdout:string;stderr:string}>(resolve=>{
      const child=spawn("java",["-Dfile.encoding=UTF-8","-cp",out,"LinkCheck",javaUri]);let stdout="",stderr="";
      child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);
      const timer=setTimeout(()=>child.kill(),60_000);
      child.on("close",status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
    });
    assert.equal(r.status,0,"java: "+r.stderr+r.stdout);
    const j=JSON.parse(r.stdout.trim().split("\n").pop()!);
    assert.match(j.deviceId,/^dev_/);assert.equal(j.computer,"PC-اختبار");
    assert.equal(j.whoami.deviceId,j.deviceId);
    assert.deepEqual([j.echoStatus,j.echo.principal,j.echo.body.text],[200,`device:${j.deviceId}`,"مرحبا"],"Arabic text intact both ways");
    assert.deepEqual(j.audio.bytes,[0,1,2,3,4]);
    assert.deepEqual([j.first,j.replay],[200,409]);
    assert.equal(j.device.lastUrl,base,"the unreachable address was skipped and the working one remembered");
    assert.equal("privateKey" in j.device,false);
    console.log("phone-link: Java phone code checked against the gateway");
  }else console.log("phone-link: Java part skipped (no javac)");
}finally{
  await gw.close();await new Promise<void>(r=>upstream.close(()=>r()));
  fs.rmSync(dir,{recursive:true,force:true});
}
console.log("phone-link: QR pairing pinned to this PC's key, sealed requests and answers, no replay or tampering, old plain link refused");
process.exit(0);
