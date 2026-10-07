import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {isLoopbackUrl,parseZapReport,webBaseline,zapDockerArgs,zapBaseline,DEFAULT_ZAP_IMAGE} from "../src/autonomy/web-scan.js";
import {securityReport} from "../src/autonomy/security-scan.js";
import {pinnedImage} from "../src/autonomy/external-agents.js";
import {startCarelessApp} from "./fixtures/careless-web-app.js";

process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-web-store-"));
process.env.LAYANX_EXTERNAL_SCANNERS="off";

// A careful app: the baseline should stay quiet.
const good=http.createServer((req,res)=>{
  res.writeHead(req.url==="/"?200:404,{"content-type":"text/html","content-security-policy":"default-src 'self'; frame-ancestors 'none'","x-content-type-options":"nosniff","referrer-policy":"no-referrer","set-cookie":"sid=1; Path=/; HttpOnly; SameSite=Strict"});
  res.end(req.url==="/"?"<html><body><a href='/x'>x</a></body></html>":"missing");
});
const listen=(s:http.Server)=>new Promise<number>(r=>s.listen(0,"127.0.0.1",()=>r((s.address() as {port:number}).port)));
const {server:bad,port:badPort}=await startCarelessApp();const goodPort=await listen(good);

// 1. Only this computer.
assert.equal(isLoopbackUrl(`http://127.0.0.1:${badPort}/`),true);
assert.equal(isLoopbackUrl("http://localhost:3000"),true);
assert.equal(isLoopbackUrl("http://[::1]:3000/"),true);
for(const u of ["https://example.com","http://192.168.1.5:3000","http://localhost.evil.com","file:///etc/passwd","http://127.0.0.1.nip.io"])assert.equal(isLoopbackUrl(u),false,u);
await assert.rejects(webBaseline("https://example.com"),/only checks apps running on this computer/);

// 2. The careless app: each problem found once, with the page it was seen on; external links never fetched.
const fetched:string[]=[];
const spy=((u:string|URL|Request,i?:RequestInit)=>{fetched.push(String(u));return fetch(u,i);}) as typeof fetch;
const r=await webBaseline(`http://127.0.0.1:${badPort}/`,{fetcher:spy,zap:false});
const rules=new Map(r.findings.map(f=>[f.rule,f]));
for(const id of ["zap.10038","zap.10055.eval","zap.10055.inline","zap.10020","zap.10021","zap.10036","zap.10037","zap.10010","zap.10054","zap.10098","zap.90022","zap.90003","web.exposed--env","web.exposed--git-HEAD","headers.referrer-policy"])assert.ok(rules.has(id),"finding "+id+" in "+[...rules.keys()].join(","));
assert.equal(rules.get("zap.10098")!.severity,"high","reflected CORS with credentials");
assert.equal(rules.get("web.exposed--env")!.severity,"high");
assert.match(rules.get("zap.10010")!.message,/session_id/);
assert.ok(!r.findings.some(f=>/"theme"/.test(f.message)&&f.rule==="zap.10010"),"a cookie with HttpOnly is not reported");
assert.equal(r.findings.filter(f=>f.rule==="zap.10021").length,1,"one finding per rule, not one per URL");
assert.ok(r.pages.length>=3&&r.pages.length<=20,"crawled the linked pages: "+r.pages.join(" "));
assert.ok(!fetched.some(u=>/example\.(com|example)|other\.example/.test(u)),"never fetches other sites: "+fetched.join(" "));
assert.ok(!fetched.some(u=>u.endsWith("/logo.png")),"images are not crawled");
assert.deepEqual(r.missing.sort(),["Content-Security-Policy","Frame-Protection","Referrer-Policy","X-Content-Type-Options"]);

// 3. The careful app is clean.
const g=await webBaseline(`http://127.0.0.1:${goodPort}/`,{zap:false});
assert.deepEqual(g.findings.map(f=>f.rule),[],"no findings on a careful app");

// 4. It flows into the project security report and blocks delivery on high findings.
const proj=fs.mkdtempSync(path.join(os.tmpdir(),"lx-web-proj-"));fs.writeFileSync(path.join(proj,"index.js"),"console.log('hi')\n");
const report=await securityReport(proj,{audit:false,url:`http://127.0.0.1:${badPort}/`,zap:false});
assert.equal(report.blocked,true);assert.ok(report.web!.pages>=3);assert.ok(report.headers!.missing.includes("Content-Security-Policy"));
const remote=await securityReport(proj,{audit:false,url:"https://example.com",zap:false});
assert.match(remote.web!.note!,/this computer/);assert.equal(remote.web!.pages,0);

// 5. Real ZAP: report parsing, docker argv per platform, pinned image, switches.
const zapJson=JSON.stringify({"@version":"2.17.0",site:[{"@name":"http://host.docker.internal:5173",alerts:[
  {pluginid:"10038",alert:"Content Security Policy (CSP) Header Not Set",name:"Content Security Policy (CSP) Header Not Set",riskcode:"2",confidence:"3",solution:"<p>Ensure that your web server sets the CSP header.</p>",instances:[{uri:"http://host.docker.internal:5173/",method:"GET"},{uri:"http://host.docker.internal:5173/a",method:"GET"}]},
  {pluginid:"10202",alert:"Absence of Anti-CSRF Tokens",name:"Absence of Anti-CSRF Tokens",riskcode:"1",solution:"<p>Use a vetted library.</p>",instances:[{uri:"http://host.docker.internal:5173/form"}]}]}]});
const zf=parseZapReport(zapJson);
assert.deepEqual(zf.map(f=>[f.rule,f.severity]),[["zap.10038","medium"],["zap.10202","low"]]);
assert.match(zf[0]!.message,/\(2 URLs\)/);assert.equal(zf[0]!.fix,"Ensure that your web server sets the CSP header.");
const win=zapDockerArgs("http://localhost:5173/app","C:\\Temp\\lx-zap-1",DEFAULT_ZAP_IMAGE,"win32");
assert.ok(win.includes("http://host.docker.internal:5173/app"),"Docker Desktop reaches this PC through host.docker.internal");
assert.ok(win.includes("type=bind,source=C:\\Temp\\lx-zap-1,target=/zap/wrk"));
assert.deepEqual(win.slice(win.indexOf("zap-baseline.py")),["zap-baseline.py","-t","http://host.docker.internal:5173/app","-J","zap.json","-m","1","-T","5","-I"]);
const lin=zapDockerArgs("http://127.0.0.1:5173/","/tmp/w",DEFAULT_ZAP_IMAGE,"linux");
assert.ok(lin.includes("--network")&&lin.includes("http://127.0.0.1:5173/"));
assert.equal(pinnedImage(DEFAULT_ZAP_IMAGE),true);
assert.match((await zapBaseline("http://127.0.0.1:1/",{LAYANX_ZAP:"off"})).note!,/switched off/);
assert.match((await zapBaseline("http://127.0.0.1:1/",{LAYANX_ZAP_IMAGE:"zaproxy/zap-stable:latest"})).note!,/exact version/);

bad.close();good.close();fs.rmSync(proj,{recursive:true,force:true});
console.log(`web-scan: loopback only, ${r.findings.length} baseline findings on a careless app, none on a careful one, ZAP report parsing and docker argv verified`);
process.exit(0);
