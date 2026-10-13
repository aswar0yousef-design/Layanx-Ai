import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import {buildCertificate,certificateFingerprint,ensureLanCertificate} from "../src/security/lan-tls.js";
import {AccessManager} from "../src/security/access.js";
import {freeLoopbackPort,lanUrls,startGateway} from "../src/security/local-gateway.js";
import {qrMatrix,qrSvg} from "../src/platform/qr.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-lantls-"));

// ---------- 1. the certificate ----------
const dir=path.join(root,"tls");
const cert=ensureLanCertificate(dir,{installId:"lx-test"});
const x509=new crypto.X509Certificate(cert.cert);
assert.equal(x509.verify(crypto.createPublicKey(cert.key)),true,"self-signed with its own key");
assert.equal(x509.ca,false,"not a CA certificate");
assert.match(x509.subject,/CN=LayanX lx-test/);
assert.match(x509.subjectAltName??"",/IP Address:127\.0\.0\.1/);
assert.equal(x509.checkPrivateKey(crypto.createPrivateKey(cert.key)),true);
assert.ok(new Date(x509.validTo).getTime()-Date.now()>9*365*86400_000,"valid for years: renewing it means pairing again");
assert.match(cert.fingerprint,/^[0-9a-f]{64}$/);
assert.equal(Buffer.from(cert.pin,"base64url").toString("hex"),cert.fingerprint,"pin = fingerprint in base64url");
assert.equal(cert.fingerprint,crypto.createHash("sha256").update(x509.raw).digest("hex"));
assert.equal(ensureLanCertificate(dir).fingerprint,cert.fingerprint,"kept across restarts (phones stay paired)");
// damaged or about to expire: a new one
fs.writeFileSync(path.join(dir,"lan-cert.pem"),"broken");
const fresh=ensureLanCertificate(dir);
assert.notEqual(fresh.fingerprint,cert.fingerprint,"a damaged certificate is replaced");
const later=ensureLanCertificate(dir,{now:()=>new Date(Date.now()+3640*86400_000)});
assert.notEqual(later.fingerprint,fresh.fingerprint,"renewed 30 days before it expires");
// GeneralizedTime after 2049, UTCTime before
const k=crypto.generateKeyPairSync("ec",{namedCurve:"P-256"});
const far=new crypto.X509Certificate(Buffer.from(buildCertificate(k.privateKey,k.publicKey,{commonName:"x",dnsNames:["a"],ips:["10.0.0.1","bad"],notBefore:new Date("2049-12-31T00:00:00Z"),notAfter:new Date("2060-01-01T00:00:00Z")})));
assert.equal(new Date(far.validTo).getUTCFullYear(),2060);
assert.equal(new Date(far.validFrom).getUTCFullYear(),2049);
assert.equal(certificateFingerprint(fresh.cert).fingerprint,fresh.fingerprint);

// ---------- 2. the gateway: TLS and HTTP on one port; plain HTTP refused from the LAN ----------
const access=new AccessManager({devicesFile:path.join(root,"d.json"),launchTicketFile:path.join(root,"t.json"),masterToken:"lxm_tls_master"});
const upstreamPort=await freeLoopbackPort();
const upstream=http.createServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({principal:req.headers["x-layanx-principal"],proto:req.headers["x-forwarded-proto"]}));});
await new Promise<void>(r=>upstream.listen(upstreamPort,"127.0.0.1",()=>r()));
let fromLan=true;
const port=await freeLoopbackPort();
const gw=await startGateway({
  bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:port,internalPort:upstreamPort}],access,internalToken:"internal",mobileAccess:true,
  tls:{key:fresh.key,cert:fresh.cert},
  isLoopback:()=>!fromLan,localAddresses:()=>["127.0.0.1"],log:()=>undefined,
  handleOwnRoute:async ctx=>{
    if(ctx.url.pathname==="/v1/pair/complete"){const body=await ctx.readJson() as {code?:string};const r=access.completePairing(body.code,"phone",ctx.remoteAddress);ctx.sendJson(r.ok?200:r.status,r);return true;}
    return false;
  }
});

interface Reply{status:number;json:any;peer?:string}
function plain(method:string,p:string,headers:Record<string,string>={},body?:unknown):Promise<Reply>{
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const r=http.request({host:"127.0.0.1",port,method,path:p,headers:{...(payload?{"content-type":"application/json"}:{}),...headers}},res=>{let t="";res.on("data",c=>t+=c);res.on("end",()=>resolve({status:res.statusCode??0,json:JSON.parse(t||"null")}));});
    r.on("error",reject);if(payload)r.write(payload);r.end();
  });
}
/** What the phone does: accept exactly the pinned certificate, whatever the address. */
function pinned(pin:string,method:string,p:string,headers:Record<string,string>={},body?:unknown):Promise<Reply>{
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const r=https.request({host:"127.0.0.1",port,method,path:p,rejectUnauthorized:false,agent:false,headers:{...(payload?{"content-type":"application/json"}:{}),...headers}},res=>{
      const peer=(res.socket as tls.TLSSocket).getPeerX509Certificate();
      const got=crypto.createHash("sha256").update(peer!.raw).digest("base64url");
      if(got!==pin){res.destroy();reject(new Error("pin mismatch"));return;}
      let t="";res.on("data",c=>t+=c);res.on("end",()=>resolve({status:res.statusCode??0,json:JSON.parse(t||"null"),peer:got}));
    });
    r.on("error",reject);if(payload)r.write(payload);r.end();
  });
}
try{
  const code=access.startPairing().code;
  const refused=await plain("POST","/v1/pair/complete",{},{code});
  assert.equal(refused.status,426,"plain HTTP from the LAN never carries a pairing code or token");
  assert.equal(refused.json.error,"tls_required");
  const paired=await pinned(fresh.pin,"POST","/v1/pair/complete",{},{code});
  assert.equal(paired.status,200);assert.equal(paired.peer,fresh.pin);
  const token=paired.json.deviceToken as string;
  const call=await pinned(fresh.pin,"GET","/x",{authorization:"Bearer "+token});
  assert.equal(call.status,200);
  assert.match(call.json.principal,/^device:dev_/);
  assert.equal(call.json.proto,"https");
  assert.equal((await plain("GET","/x",{authorization:"Bearer "+token})).status,426,"a token sent in the clear is refused before it is checked");
  await assert.rejects(pinned(cert.pin,"GET","/x",{authorization:"Bearer "+token}),/pin mismatch/,"another certificate (a man in the middle) is refused by the phone");
  // this computer itself may keep using plain HTTP
  fromLan=false;
  const local=await plain("GET","/x",{authorization:"Bearer "+token});
  assert.equal(local.status,200);assert.equal(local.json.proto,"http");
  // a connection that sends nothing does not hold up the port
  const idle=net.connect(port,"127.0.0.1");
  await new Promise(r=>idle.once("connect",r));
  const other=await plain("GET","/x",{authorization:"Bearer "+token});
  assert.equal(other.status,200);
  idle.destroy();
}finally{await gw.close();}

// LAN listener without a certificate: the LAN is refused rather than served in the clear
const port2=await freeLoopbackPort();
const noCert=await startGateway({bindHost:"127.0.0.1",listeners:[{name:"api",publicPort:port2,internalPort:upstreamPort}],access,internalToken:"i",mobileAccess:true,requireLanTls:true,isLoopback:()=>false,localAddresses:()=>["127.0.0.1"],log:()=>undefined,handleOwnRoute:async()=>false});
try{
  const r=await new Promise<number>((resolve,reject)=>{http.get({host:"127.0.0.1",port:port2,path:"/x"},res=>{res.resume();resolve(res.statusCode??0);}).on("error",reject);});
  assert.equal(r,426);
}finally{await noCert.close();await new Promise<void>(r=>upstream.close(()=>r()));}

assert.deepEqual(lanUrls(3000,["192.168.1.5"],"https"),["https://192.168.1.5:3000"]);
assert.deepEqual(lanUrls(3000,["192.168.1.5"]),["http://192.168.1.5:3000"]);

// ---------- 3. pairing link + QR ----------
const {pairingLink}=await import("../src/local/setup-routes.js");
const link=pairingLink({code:"ABCD-2345",urls:["https://192.168.1.5:3000","https://pc.tail1.ts.net"],pin:fresh.pin,computer:"RYZEN"});
const u=new URL(link);
assert.equal(u.protocol,"layanx:");
assert.equal(u.searchParams.get("c"),"ABCD2345");
assert.equal(u.searchParams.get("p"),fresh.pin);
assert.deepEqual(u.searchParams.getAll("u"),["https://192.168.1.5:3000","https://pc.tail1.ts.net"]);
assert.ok(link.length<260,"fits a small QR code");

// The QR encoder: structure checks plus a matrix verified with a real decoder (OpenCV) when written.
const fixed="layanx://pair?v=1&c=ABCD2345&p=x7Q0n2bq8VZt3s1Yw4u9rL6eK5aF2gH8jM0pN3oP1iU&n=RYZEN&u=https%3A%2F%2F192.168.1.5%3A3000";
const m=qrMatrix(fixed);
assert.equal(m.length,m[0]!.length);assert.equal((m.length-17)%4,0);
const finderOk=(x:number,y:number)=>[0,6].every(d=>m[y]![x+d]===true&&m[y+d]![x]===true)&&m[y+1]![x+1]===false&&m[y+3]![x+3]===true;
assert.ok(finderOk(0,0)&&finderOk(m.length-7,0)&&finderOk(0,m.length-7),"three finder patterns");
for(let i=8;i<m.length-8;i++)assert.equal(m[6]![i],i%2===0,"timing pattern");
// format information (level M) must be one of the 8 valid codewords, and both copies must agree
const fmtA=[0,1,2,3,4,5,7,8].map(y=>m[y]![8]).concat([7,5,4,3,2,1,0].map(x=>m[8]![x]));
let bitsA=0;[...Array(6).keys()].forEach(i=>{bitsA|=(m[i]![8]?1:0)<<i;});
bitsA|=(m[7]![8]?1:0)<<6;bitsA|=(m[8]![8]?1:0)<<7;bitsA|=(m[8]![7]?1:0)<<8;for(let i=9;i<15;i++)bitsA|=(m[8]![14-i]?1:0)<<i;
let bitsB=0;for(let i=0;i<8;i++)bitsB|=(m[8]![m.length-1-i]?1:0)<<i;for(let i=8;i<15;i++)bitsB|=(m[m.length-15+i]![8]?1:0)<<i;
void fmtA;
const valid=[...Array(8).keys()].map(mask=>{const v=mask;let r=v;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);return((v<<10)|r)^0x5412;});
assert.ok(valid.includes(bitsA),"format bits encode level M and a mask");
assert.equal(bitsA,bitsB,"both copies of the format bits agree");
assert.equal(crypto.createHash("sha256").update(m.map(r=>r.map(b=>b?1:0).join("")).join("\n")).digest("hex").slice(0,16),"5c2b629539929bdc");
assert.throws(()=>qrMatrix("x".repeat(2000)),/too long/);
const svg=qrSvg(link);
assert.match(svg,/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
assert.ok(/^[\x20-\x7e]+$/.test(svg),"plain ASCII (the page base64-encodes it)");

fs.rmSync(root,{recursive:true,force:true});
console.log("lan-tls: pinned certificate, TLS on the same port, plain HTTP refused from the LAN, pairing QR");
