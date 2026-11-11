import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildNodeRepairPrompt,failingTestNames,framesInProject,hasRealTestScript,isTestFile,needsDependencies,nodeRepairSetback,observeTestRun} from "../src/autonomy/node-repair.js";
import {prepareRepair} from "../src/autonomy/repair-engine.js";
import {NODE_EDITABLE} from "../src/autonomy/node-repair.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-node-repair-"));
const write=(file:string,text:string)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),text);};
write("package.json",JSON.stringify({name:"x",type:"module",scripts:{test:"node --test"}}));
write("src/page.js","import {size} from './size.js';\nexport function page(items,n){return items.slice(n,n+size());}\n");
write("src/size.js","export const size=()=>2;\n");
write("src/unrelated.js","export const other=1;\n");
write("test/page.test.js","import {page} from '../src/page.js';\n");
const policy={editable:NODE_EDITABLE,forbidden:(file:string)=>isTestFile(file)?"Tests must not be changed to make them pass: "+file:undefined};

// Test output from the runners people use.
assert.deepEqual(failingTestNames("not ok 1 - adds\nok 2 - keeps\nnot ok 3 - removes\n"),["adds","removes"]);
assert.deepEqual(failingTestNames("✖ adds (1.2ms)\n✔ keeps (1ms)\n✖ failing tests:\n✖ adds (1.2ms)\n"),["adds"]);
assert.deepEqual(failingTestNames("  ● math › adds\n"),["math › adds"]);
assert.deepEqual(failingTestNames("  1) adds numbers:\n"),["adds numbers"]);
assert.deepEqual(failingTestNames("all good\n"),[]);

assert.equal(hasRealTestScript(dir),true);
write("no/package.json",JSON.stringify({scripts:{test:'echo "Error: no test specified" && exit 1'}}));
assert.equal(hasRealTestScript(path.join(dir,"no")),false);
assert.equal(needsDependencies(dir),false);
write("dep/package.json",JSON.stringify({dependencies:{a:"1"}}));
assert.equal(needsDependencies(path.join(dir,"dep")),true);

// The exit code decides, never the wording of the output.
assert.equal(observeTestRun({exitCode:0,stdout:"0 failing"}).ok,true);
assert.equal(observeTestRun({exitCode:1,stdout:"everything is fine"}).ok,false);
assert.equal(observeTestRun({exitCode:0,timedOut:true}).ok,false);
assert.equal(observeTestRun({exitCode:0,ok:false}).ok,false);

// Stack frames lead to project files, and never into dependencies or outside the project.
const trace=`at page (file:///${dir.replace(/\\/g,"/")}/src/page.js:2:9)\nat x (${path.join(dir,"node_modules","a.js")}:1:1)\nat y (C:/elsewhere/a.js:1:1)`;
assert.deepEqual(framesInProject(dir,trace),["src/page.js"]);

// The prompt holds the code the failing test reaches, one hop deeper, and the tests as read-only.
const failing=observeTestRun({exitCode:1,stdout:"✖ pages\n"+trace+"\nAssertionError: expected 2",stderr:""});
const prompt=buildNodeRepairPrompt(dir,"pagination is wrong",failing);
assert.match(prompt,/--- src\/page\.js[\s\S]*--- src\/size\.js/);
assert.match(prompt,/failing tests \(read only\)[\s\S]*test\/page\.test\.js/);
assert.ok(prompt.indexOf("src/page.js")<prompt.indexOf("src/unrelated.js"),"the code that failed comes first");

// Tests cannot be changed to pass, and neither can package.json.
assert.throws(()=>prepareRepair(dir,{cause:"c",edits:[{path:"test/page.test.js",find:"import",replace:"// import"}]},policy),/Tests must not be changed/);
assert.throws(()=>prepareRepair(dir,{cause:"c",edits:[{path:"package.json",find:"node --test",replace:"echo ok"}]},policy),/not allowed/);
assert.throws(()=>prepareRepair(dir,{cause:"c",edits:[{path:"src/page.js",find:"slice(n",replace:"slice(("}]},policy),/breaks src\/page\.js/);
assert.equal(prepareRepair(dir,{cause:"c",edits:[{path:"src/page.js",find:"slice(n,n+size())",replace:"slice(n-1,n-1+size())"}]},policy).files[0]!.path,"src/page.js");

// Judging a patch.
const run=(failingNames:string[],extra="")=>observeTestRun({exitCode:failingNames.length?1:0,stdout:failingNames.map(n=>"✖ "+n).join("\n")+extra});
assert.equal(nodeRepairSetback(run(["a"]),run([])),undefined,"all pass");
assert.equal(nodeRepairSetback(run(["a","b"]),run(["b"])),undefined,"fewer failures is progress");
assert.match(nodeRepairSetback(run(["a"]),run(["a","b"]))!,/broke tests that passed: b/);
assert.match(nodeRepairSetback(run(["a"]),run(["a"]))!,/did not change what the browser observes|did not change/);
assert.match(nodeRepairSetback(run(["a"]),observeTestRun({exitCode:null,timedOut:true}))!,/hang/);

// A TypeScript project imports its sources as .js: the model must still be shown the real .ts file, and a patch naming .js must land on it.
const tsDir=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-node-repair-ts-"));
fs.mkdirSync(path.join(tsDir,"src"));fs.mkdirSync(path.join(tsDir,"tests"));
for(let i=0;i<8;i++)fs.writeFileSync(path.join(tsDir,"src",`a-filler-${i}.ts`),"export const filler='"+"x".repeat(1400)+"';\n");
fs.writeFileSync(path.join(tsDir,"src","target.ts"),"export const answer=41;\n");
fs.writeFileSync(path.join(tsDir,"tests","target.spec.ts"),"import {answer} from '../src/target.js';\n");
const tsPrompt=buildNodeRepairPrompt(tsDir,"wrong answer",observeTestRun({exitCode:1,stderr:`at x (${path.join(tsDir,"tests","target.spec.ts")}:1:1)`}));
assert.match(tsPrompt,/--- src\/target\.ts\nexport const answer=41;/);
assert.equal(prepareRepair(tsDir,{cause:"c",edits:[{path:"src/target.js",find:"41",replace:"42"}]},{editable:NODE_EDITABLE}).files[0]!.path,"src/target.ts");
fs.rmSync(tsDir,{recursive:true,force:true});

console.log("node-repair: test output is read correctly, the failure leads to the code, and tests cannot be edited to pass");
