import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {apiSpecFiles,buildPlan,HTTP_API_PROFILE,isBuildProfile,parseApiCases,serverPrompt,SERVER_FILE} from "../src/autonomy/project-build.js";
import {newProjectKind} from "../src/voice/project-intent.js";

// Requests that took the general path on 2026-11-12 (a working store page reported failed; a shipments server never started).
assert.equal(newProjectKind("ابن لي صفحة متجر عطور في ملف index.html: تعرض 3 عطور وسلة"),"static-site");
assert.equal(newProjectKind("اعمل لي خادم Node لإدارة الشحنات"),"http-api");
assert.equal(newProjectKind("build me a REST api for orders"),"http-api");
assert.equal(newProjectKind("ابن لي متجر فيه دفع وتسجيل دخول"),"general","payment and login still need the general path");
assert.ok(isBuildProfile(HTTP_API_PROFILE));
assert.deepEqual(buildPlan(HTTP_API_PROFILE,"x","/nowhere").milestones.map(m=>m.stage),["spec","code"]);

const cases=parseApiCases({cases:[
  {method:"post",path:"/shipments",body:{tracking:"A1",city:"Aden"},status:201,expect:{tracking:"A1",status:"new"},why:"creates"},
  {method:"GET",path:"/shipments",status:200,expect:[{tracking:"A1"}]},
  {method:"PATCH",path:"/shipments/:id",body:{status:"delivered"},status:200,expect:{status:"delivered"}},
  {method:"PATCH",path:"/shipments/999",body:{status:"x"},status:404},
  {method:"POST",path:"/shipments",body:{tracking:"B2",city:"Taiz"},status:201,expect:{tracking:"B2"}},
  {method:"GET",path:"/shipments",status:200},
  {method:"PATCH",path:"/shipments/:id",body:{status:"lost"},status:200,expect:{tracking:"B2",status:"lost"},why:"a list in between must not change which shipment :id means"},
  {method:"TRACE",path:"/x",status:200},{method:"GET",path:"no-slash",status:200}
]});
assert.equal(cases.length,7,"unusable calls are dropped");
assert.throws(()=>parseApiCases({cases:[{method:"GET",path:"/a",status:200},{method:"GET",path:"/b",status:200},{method:"GET",path:"/c",status:200},{method:"GET",path:"/d",status:200}]}),/change data/);

// The generated test fails against the empty server and passes against a correct one.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"api-build-"));
for(const file of apiSpecFiles("shipments api",cases)){fs.mkdirSync(path.dirname(path.join(dir,file.path)),{recursive:true});fs.writeFileSync(path.join(dir,file.path),file.content);}
const run=()=>spawnSync(process.execPath,["--test"],{cwd:dir,encoding:"utf8",windowsHide:true,timeout:60_000});
const empty=run();
assert.notEqual(empty.status,0,"the calls fail against the placeholder");
assert.match(empty.stdout,/the server did not answer/);
fs.writeFileSync(path.join(dir,SERVER_FILE),`import http from "node:http";
const list=[];let next=1;
http.createServer(async(q,r)=>{let b="";for await(const c of q)b+=c;const send=(s,v)=>{r.writeHead(s,{"content-type":"application/json"});r.end(JSON.stringify(v));};
const m=/^\\/shipments(?:\\/([^/]+))?$/.exec(q.url);if(!m)return send(404,{error:"not found"});
if(q.method==="GET"&&!m[1])return send(200,list);
if(q.method==="POST"&&!m[1]){const d=JSON.parse(b||"{}");const s={id:String(next++),tracking:d.tracking,city:d.city,status:"new"};list.push(s);return send(201,s);}
if(q.method==="PATCH"&&m[1]){const s=list.find(x=>x.id===m[1]);if(!s)return send(404,{error:"not found"});s.status=JSON.parse(b||"{}").status;return send(200,s);}
send(405,{});}).listen(Number(process.env.PORT)||3000);
`);
const good=run();
assert.equal(good.status,0,good.stdout.slice(-1500));
assert.match(serverPrompt("shipments api",dir),/never require/);
fs.rmSync(dir,{recursive:true,force:true});
console.log("http-api-build: calls written first and locked; they fail on an empty server and pass on a correct one; store pages stay pages");

// An impossible count on an id is read as the number shown (a store page failed "expectCount #cartCount 2" four times).
{
  const {parseSiteSteps}=await import("../src/autonomy/project-build.js");
  const steps=parseSiteSteps({steps:[{action:"click",selector:"#add1"},{action:"expectCount",selector:"#cartCount",value:"2"},{action:"expectCount",selector:"#items",value:"1"},{action:"expectText",text:"250"}]});
  assert.deepEqual(steps[1],{action:"expectText",text:"2"});
  assert.equal(steps[2]!.action,"expectCount","a count of one stays a count");
  console.log("http-api-build: impossible id counts become the number shown");
}

// Data the step writer chose (prices nobody named) reaches the blind second reading and the page builder.
{
  const {parseSiteFacts,siteSecondOpinionPrompt,siteSpecFiles,sitePrompt}=await import("../src/autonomy/project-build.js");
  const written={facts:"Products: Oud 120 SAR (#add1), Musk 80 SAR (#add2).",steps:[{action:"click",selector:"#add1"},{action:"expectText",text:"120"}]};
  const facts=parseSiteFacts(written);
  assert.match(siteSecondOpinionPrompt("store page",written.steps as never,facts),/Oud 120 SAR/);
  const d=fs.mkdtempSync(path.join(os.tmpdir(),"facts-"));
  for(const f of siteSpecFiles(written.steps as never,facts)){fs.mkdirSync(path.dirname(path.join(d,f.path)),{recursive:true});fs.writeFileSync(path.join(d,f.path),f.content);}
  assert.match(sitePrompt("store page",d),/must show exactly these facts[^\n]*Musk 80 SAR/);
  assert.equal(parseSiteFacts({steps:[]}),"");
  fs.rmSync(d,{recursive:true,force:true});
  console.log("http-api-build: chosen facts reach the second reading and the builder");
}

// A write that sends nothing is refused while the calls are written (seen live: POST with no body expecting tracking).
assert.throws(()=>parseApiCases({cases:[{method:"POST",path:"/s",status:201,expect:{tracking:"A"}},{method:"GET",path:"/s",status:200,expect:[]},{method:"GET",path:"/s/1",status:200},{method:"GET",path:"/x",status:404}]}),/call 1 \(POST \/s\) sends no JSON body/);
console.log("http-api-build: writes without a body are refused");
