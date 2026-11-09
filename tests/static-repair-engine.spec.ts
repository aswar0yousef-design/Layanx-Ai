import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildRepairPrompt,evidenceTokens,expectedPhrases,isStaticWebProject,prepareRepair,repairSetback,reportedPages,sourceBlocks,summarizeObservation,type PageObservation,type StaticObservation} from "../src/autonomy/repair-engine.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-repair-spec-"));
process.env.LAYANX_WORKSPACE_ROOT=dir;
const project=path.join(dir,"site");fs.mkdirSync(project);
const write=(name:string,text:string)=>fs.writeFileSync(path.join(project,name),text);
write("list.html",'<body data-page="list"><div id="items-box"></div><script src="app.js"></script></body>');
write("other.html","<body></body>");
write("app.js","function loadState() {\n  createDemo();\n}\n\nfunction render() {\n  document.getElementById('items-box').textContent = 'x';\n}\n\nfunction init() {\n  loadState();\n  render();\n}\n\ndocument.addEventListener('DOMContentLoaded', init);\n");

assert.equal(isStaticWebProject(project),true);
assert.deepEqual(reportedPages("page list.html is broken",["list.html","other.html"]),["list.html"]);
assert.deepEqual(reportedPages("everything is broken",["list.html","other.html"]),["list.html","other.html"]);
assert.deepEqual(expectedPhrases("should show «لا توجد عناصر» there"),["لا توجد عناصر"]);
assert.deepEqual(sourceBlocks("a.js","function a() {\n  b();\n}\nconst c = 1;\n").map(b=>b.name),["a","c"]);

const page=(over:Partial<PageObservation>):PageObservation=>({page:"list.html",target:true,errors:[],consoleErrors:[],missing:[],text:"",...over});
const crash=page({errors:[{message:"createDemo is not defined",stack:"ReferenceError: createDemo is not defined\n    at loadState (http://127.0.0.1/app.js:2:3)"}]});
const failing=summarizeObservation([crash,page({page:"other.html",target:false})]);
assert.equal(failing.ok,false);
assert.equal(summarizeObservation([page({page:"list.html"}),page({page:"other.html",target:false,errors:crash.errors})]).ok,true,"an older bug on another page does not block the reported one");
assert.equal(summarizeObservation([page({missing:["x"]})]).ok,false,"expected text is part of the verdict");
assert.equal(summarizeObservation([page({target:false})]).ok,false,"no reported page observed is not success");
assert.ok(evidenceTokens("box items-box is empty",failing).includes("createDemo"));
assert.ok(evidenceTokens("box items-box is empty",failing).includes("items-box"));
const prompt=buildRepairPrompt(project,"box items-box is empty on list.html",failing);
assert.match(prompt,/function loadState/);assert.match(prompt,/function init/,"callers of the failing code are included");
assert.match(prompt,/app\.js:2: createDemo\(\);/,"every occurrence of the undefined name is listed");

// A report in plain words still leads to the code: the expected text and the empty elements on the page are evidence.
write("plain.js","function showNext() {\n  document.getElementById('next-box').textContent = 'nothing due';\n}\nfunction unrelatedThing() {\n  return 1;\n}\n");
const silent=summarizeObservation([page({missing:["nothing due"],emptyIds:["next-box"]})]);
assert.ok(evidenceTokens("the box should say «nothing due»",silent).includes("nothing due"));
assert.ok(evidenceTokens("the box is blank",silent).includes("next-box"));

// A patch is validated against the files on disk and nothing is written.
const original=fs.readFileSync(path.join(project,"app.js"),"utf8");
const ok=prepareRepair(project,{cause:"undefined call",edits:[{path:"./app.js",find:"  createDemo();\n",replace:""}]});
assert.equal(ok.files[0]!.path,"app.js");assert.ok(!ok.files[0]!.content.includes("createDemo"));
assert.equal(fs.readFileSync(path.join(project,"app.js"),"utf8"),original,"preparing a patch writes nothing");
const reject=(edits:unknown,pattern:RegExp)=>assert.throws(()=>prepareRepair(project,{edits}),pattern);
assert.throws(()=>prepareRepair(project,null),/no edits/);
reject([],/no edits/);
reject([{path:"../outside.js",find:"a",replace:"b"}],/not allowed/);
reject([{path:".layanx/x.js",find:"a",replace:"b"}],/not allowed/);
reject([{path:"package.json",find:"a",replace:"b"}],/not allowed/);
reject([{path:"missing.js",find:"a",replace:"b"}],/does not exist/);
reject([{path:"app.js",find:"not there at all",replace:"b"}],/occurs 0 times/);
reject([{path:"app.js",find:"()",replace:"(1)"}],/exactly once/);
reject([{path:"app.js",find:"loadState();",replace:"loadState();"}],/changes nothing/);
reject([{path:"app.js",find:"function render() {",replace:"function render( {"}],/breaks app\.js/);
reject([{path:"app.js",find:"  render();",replace:Array(50).fill("//x").join("\n")}],/limit/);
reject([1,2,3,4],/More than 3/);
// A patch may not orphan what returning users saved: an empty-profile browser check cannot see that.
write("store.js","const savedData = localStorage.getItem('appData');\nconst other = localStorage.getItem('keep');\nconst STORAGE_KEY = 'app:v1';\nfunction use() { return savedData; }\n");
reject([{path:"store.js",find:"localStorage.getItem('appData')",replace:"localStorage.getItem(window.Data.KEY)"}],/saved data/);
reject([{path:"store.js",find:"const other = localStorage.getItem('keep');\n",replace:""}],/saved data/);
reject([{path:"store.js",find:"STORAGE_KEY = 'app:v1'",replace:"STORAGE_KEY = 'app:v2'"}],/saved data/);
assert.ok(prepareRepair(project,{edits:[{path:"store.js",find:"const savedData = localStorage.getItem('appData');",replace:"const savedData = localStorage.getItem( 'appData' ) || '[]';"}]}).files[0]!.content.includes("|| '[]'"),"the same key used differently is fine");
assert.ok(prepareRepair(project,{edits:[{path:"store.js",find:"return savedData;",replace:"return savedData || [];"}]}),"edits away from storage are unaffected");
// Windows line endings in the project do not defeat a multi-line find.
write("crlf.js","function a() {\r\n  return 1;\r\n}\r\n");
assert.ok(prepareRepair(project,{edits:[{path:"crlf.js",find:"function a() {\n  return 1;",replace:"function a() {\n  return 2;"}]}).files[0]!.content.includes("return 2;\r\n"));

// A patch is undone when nothing observable changed or a working page broke; progress towards the fix is kept.
const observe=(pages:PageObservation[]):StaticObservation=>summarizeObservation(pages);
assert.match(repairSetback(observe([crash]),observe([crash]))!,/did not change/);
assert.match(repairSetback(observe([crash,page({page:"other.html",target:false})]),observe([page({}),page({page:"other.html",target:false,errors:crash.errors})]))!,/broke a page/);
assert.equal(repairSetback(observe([crash]),observe([page({errors:[{message:"later failure",stack:""}]})])),undefined,"a different failure is progress");
assert.equal(repairSetback(observe([crash]),observe([page({})])),undefined);
assert.equal(repairSetback(observe([page({missing:["x"]})]),observe([crash])),undefined,"a fix that exposes the next error on the reported page is kept");

// Through the supervisor: the browser observation, not the model, ends the job.
const {Supervisor}=await import("../src/autonomy/supervisor.js");
const terminal=["completed","failed","budget_exhausted","waiting_approval"];
const run=async(opts:{patches:string[];observe:(n:number)=>StaticObservation})=>{
  const writes:string[]=[];let observations=0;const prompts:string[]=[];
  const deps:any={think:async()=>"{}",runAgent:async()=>{throw new Error("the agent loop must not run");},resumeAgent:async()=>{throw new Error("unused");},
    generateRepairPatch:async(prompt:string)=>{prompts.push(prompt);return{content:opts.patches.shift()??"not json",modelId:"fake"};},
    observeStatic:async()=>opts.observe(observations++),
    runTool:async(_p:string,tool:string,payload:any)=>{if(tool==="files.write"){writes.push(payload.path);return{ok:true,data:{written:true}};}return{ok:true,data:{stdout:""}};},
    isApproved:()=>true,detect:()=>({stack:"unknown",scripts:[],git:false}),cloudAvailable:()=>false,externalAgent:()=>null};
  const supervisor=new Supervisor(deps,{file:path.join(dir,`jobs-${Math.random()}.json`),pollMs:5});
  const job=supervisor.create("box items-box is empty on list.html","site",{acceptanceProfile:"static-repair-v1"});
  for(let i=0;i<400&&!terminal.includes(supervisor.get(job.id)!.status);i++)await new Promise(r=>setTimeout(r,10));
  supervisor.stop();
  return{job:supervisor.get(job.id)!,writes,prompts};
};
const patch=JSON.stringify({cause:"undefined call",edits:[{path:"app.js",find:"  createDemo();\n",replace:""}]});
const clean=observe([page({})]);
const fixed=await run({patches:[patch],observe:n=>n<2?failing:clean});
assert.equal(fixed.job.status,"completed",fixed.job.result);
assert.equal(fixed.job.outcome?.status,"verified");
assert.ok(fixed.job.outcome?.evidence.some(e=>e.kind==="browser"&&e.passed),"browser evidence backs the completed job");
assert.deepEqual(fixed.writes.filter(p=>p==="app.js"),["app.js"]);

const notReproduced=await run({patches:[patch],observe:()=>clean});
assert.equal(notReproduced.job.status,"failed");assert.match(notReproduced.job.result!,/did not reproduce/);
assert.equal(notReproduced.prompts.length,0,"no model call and no change for a bug that does not reproduce");

const never=await run({patches:[patch,patch,patch,patch],observe:()=>failing});
assert.equal(never.job.status,"failed","a fix the browser does not confirm is never reported as success");
assert.equal(never.prompts.length,4);
assert.equal(never.writes.filter(p=>p==="app.js").length,7,"two patches held, two undone, and the held ones removed when the job gave up");
assert.match(never.prompts[1]!,/did not change what the browser observes/,"the next attempt is told why the last one failed");

const unusable=await run({patches:["no json here"],observe:()=>failing});
assert.equal(unusable.job.status,"failed");assert.equal(unusable.writes.length,0);

// A return visit counts on the reported page, and a patch may not break other pages for returning users.
assert.equal(observe([page({returningErrors:["boom"]})]).ok,false);
assert.match(observe([page({returningErrors:["boom"]})]).summary,/return visit/);
assert.equal(observe([page({errors:[{message:"boom",stack:""}],returningErrors:["boom"]})]).summary.match(/boom/g)!.length,1,"the same crash is reported once");
const otherClean=page({page:"other.html",target:false,returningErrors:[]}),otherBroken=page({page:"other.html",target:false,returningErrors:["x"]});
assert.match(repairSetback(observe([page({}),otherClean]),observe([page({}),otherBroken]))!,/returning users/);
assert.equal(repairSetback(observe([page({}),otherBroken]),observe([page({}),otherBroken])),undefined,"older bugs are not blamed on the patch");

// Two causes: a correct fix with no visible effect is held; held patches the final fix does not need are dropped.
const diskRun=async(patches:string[],works:(source:string)=>boolean)=>{
  write("app.js","var a=1;\nvar b=1;\nvar z=1;\n");
  const seeds:unknown[]=[];let baseline=true;
  const deps:any={think:async()=>"{}",runAgent:async()=>{throw new Error("unused");},resumeAgent:async()=>{throw new Error("unused");},
    generateRepairPatch:async()=>({content:patches.shift()??"not json",modelId:"fake"}),
    observeStatic:async(_d:string,_r:string,seed:unknown)=>{seeds.push(seed);const result=works(fs.readFileSync(path.join(project,"app.js"),"utf8"))?clean:failing;if(baseline){baseline=false;return{...result,storage:{key:"saved"}};}return result;},
    runTool:async(_p:string,tool:string,payload:any)=>{if(tool==="files.write"){fs.writeFileSync(path.join(project,payload.path),payload.content);return{ok:true,data:{written:true}};}return{ok:true,data:{stdout:""}};},
    isApproved:()=>true,detect:()=>({stack:"unknown",scripts:[],git:false}),cloudAvailable:()=>false,externalAgent:()=>null};
  const supervisor=new Supervisor(deps,{file:path.join(dir,`jobs-${Math.random()}.json`),pollMs:5});
  const job=supervisor.create("box items-box is empty on list.html","site",{acceptanceProfile:"static-repair-v1"});
  for(let i=0;i<400&&!terminal.includes(supervisor.get(job.id)!.status);i++)await new Promise(r=>setTimeout(r,10));
  supervisor.stop();
  return{job:supervisor.get(job.id)!,seeds,source:fs.readFileSync(path.join(project,"app.js"),"utf8")};
};
const edit=(find:string,replace:string)=>JSON.stringify({cause:find,edits:[{path:"app.js",find,replace}]});
const bothFixed=(source:string)=>source.includes("a=2")&&source.includes("b=2");
const twoCauses=await diskRun([edit("var z=1","var z=2"),edit("var a=1","var a=2"),edit("var b=1","var b=2")],bothFixed);
assert.equal(twoCauses.job.status,"completed",twoCauses.job.result);
assert.equal(twoCauses.source,"var a=2;\nvar b=2;\nvar z=1;\n","the needed fix stays and the useless patch is gone");
assert.deepEqual(twoCauses.seeds[0],undefined);assert.deepEqual(twoCauses.seeds[1],{key:"saved"},"what the unpatched app stored is replayed against every patch");
const gaveUp=await diskRun([edit("var z=1","var z=2"),edit("var a=1","var a=2"),"no json","no json"],bothFixed);
assert.equal(gaveUp.job.status,"failed");
assert.equal(gaveUp.source,"var a=1;\nvar b=1;\nvar z=1;\n","held patches do not stay when the fix was not proven");

console.log("static-repair-engine: evidence, patch validation, undo and supervisor gates verified");
process.exit(0);
