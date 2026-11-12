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

// A real library (qs, 2026-11-12): tape output, require('../'), and a source file larger than the code budget.
{
  const {tapDetails,fileExcerpt,evidenceTerms,repairEvidence,observeTestRun:observe}=await import("../src/autonomy/node-repair.js");
  const fsx=await import("node:fs"),osx=await import("node:os"),px=await import("node:path");
  const tapOut="ok 264 adds the sentinel\nnot ok 265 uses the configured delimiter after the sentinel\n  ---\n    operator: equal\n    expected: 'utf8=%E2%9C%93;a=1'\n    actual:   'utf8=%E2%9C%93&a=1'\n    at: Test.<anonymous> (C:\p\test\stringify.js:12:5)\n    stack: |-\n      Error: x\n  ...\nok 266 next\n";
  const seen=observe({exitCode:1,stdout:tapOut});
  assert.deepEqual(seen.failing,["uses the configured delimiter after the sentinel"],"tape names without a dash");
  assert.match(tapDetails(tapOut),/expected: 'utf8=%E2%9C%93;a=1'\n\s+actual:\s+'utf8=%E2%9C%93&a=1'/);
  assert.ok(!seen.summary.includes("stack:"),"stack noise left out");
  assert.ok(!evidenceTerms("the delimiter after the sentinel should be used").includes("should"));
  const big=Array.from({length:400},(_,i)=>i===300?"    prefix += 'utf8=%E2%9C%93&';":"    var filler"+i+" = "+i+";").join("\n");
  const part=fileExcerpt(big,["utf8"],[],1500);
  assert.match(part,/prefix \+= 'utf8=%E2%9C%93&';/);
  assert.match(part,/\.\.\. \(line 2\d\d\)/);
  assert.ok(part.length<1600);
  // The whole flow: require('../') reaches lib/index.js -> lib/stringify.js, which is too big to show whole.
  const dir=fsx.mkdtempSync(px.join(osx.tmpdir(),"qs-like-"));
  fsx.mkdirSync(px.join(dir,"lib"));fsx.mkdirSync(px.join(dir,"test"));
  fsx.writeFileSync(px.join(dir,"package.json"),JSON.stringify({name:"q",main:"lib/index.js",scripts:{test:"tape test/*.js"}}));
  fsx.writeFileSync(px.join(dir,"lib","index.js"),"module.exports={stringify:require('./stringify')};\n");
  fsx.writeFileSync(px.join(dir,"lib","stringify.js"),big);
  fsx.writeFileSync(px.join(dir,"lib","unrelated.js"),"x".repeat(20000));
  fsx.writeFileSync(px.join(dir,"test","stringify.js"),"var qs=require('../');\n"+Array.from({length:30},(_,i)=>"// t"+i).join("\n"));
  const ev=repairEvidence(dir,observe({exitCode:1,stdout:tapOut.replace("C:\p\test",px.join(dir,"test"))}),"charsetSentinel with delimiter puts & after utf8=");
  assert.ok(ev.files.includes("lib/index.js")&&ev.files.includes("lib/stringify.js"),ev.files.join(","));
  assert.match(ev.code,/EXCERPT of a 400-line file/);
  assert.match(ev.code,/prefix \+= 'utf8=%E2%9C%93&';/);
  assert.ok(!ev.files.includes("lib/unrelated.js"),"a large file the failure does not reach is not shown");
  fsx.rmSync(dir,{recursive:true,force:true});
  console.log("node-repair: tape failures, package main imports and excerpts of large files");
}

// Ranking (qs lowercase %2e, 2026-11-12): import order filled the budget with lib/utils.js and never showed lib/parse.js.
{
  const {repairEvidence,observeTestRun:observe}=await import("../src/autonomy/node-repair.js");
  const fsx=await import("node:fs"),osx=await import("node:os"),px=await import("node:path");
  const dir=fsx.mkdtempSync(px.join(osx.tmpdir(),"rank-"));
  fsx.mkdirSync(px.join(dir,"lib"));fsx.mkdirSync(px.join(dir,"test"));
  fsx.writeFileSync(px.join(dir,"package.json"),JSON.stringify({name:"q",main:"lib/index.js",scripts:{test:"tape test/*.js"}}));
  fsx.writeFileSync(px.join(dir,"lib","index.js"),"module.exports={utils:require('./utils'),stringify:require('./stringify'),parse:require('./parse')};\n");
  const filler=(n:number,word:string)=>Array.from({length:n},(_,i)=>`var ${word}${i} = ${i}; // ${word} helper`).join("\n");
  fsx.writeFileSync(px.join(dir,"lib","utils.js"),filler(300,"utils"));
  fsx.writeFileSync(px.join(dir,"lib","stringify.js"),filler(300,"stringify"));
  fsx.writeFileSync(px.join(dir,"lib","parse.js"),filler(250,"parse")+"\n    var decodedRoot = options.decodeDotInKeys ? cleanRoot.replace(/%2E/g, '.') : cleanRoot;\n"+filler(50,"tail"));
  fsx.writeFileSync(px.join(dir,"test","parse.js"),"var qs=require('../');\n");
  const failure=observe({exitCode:1,stdout:"not ok 39 lowercase escapes decode\n  ---\n    operator: deepEqual\n  ...\n"});
  const ev=repairEvidence(dir,failure,"qs.parse with decodeDotInKeys turns %2E into a dot but not %2e");
  assert.equal(ev.files[0],"lib/parse.js","the file the report names comes first");
  assert.match(ev.code,/cleanRoot\.replace\(\/%2E\/g, '\.'\)/);
  // A file the model named after a rejection is shown first next time.
  const again=repairEvidence(dir,failure,"something about keys","Patch rejected: find must occur exactly once in lib/stringify.js; it occurs 0 times: stringify12");
  assert.equal(again.files[0],"lib/stringify.js");
  fsx.rmSync(dir,{recursive:true,force:true});
  console.log("node-repair: evidence ranked by the report and by the model's last attempt");
}

// A rejected find says where the text is (qs: "objKeys = filter;" occurs twice; rejected six times without a hint).
{
  const {whereInFile}=await import("../src/autonomy/repair-engine.js");
  const file="a\n    if (x) {\n        objKeys = filter;\n    }\nb\n    } else {\n        objKeys = filter;\n    }\n";
  const twice=whereInFile(file,"objKeys = filter;",2);
  assert.match(twice,/3:         objKeys = filter;/);
  assert.match(twice,/7:         objKeys = filter;/);
  assert.match(twice,/2:     if \(x\) \{/);
  const missing=whereInFile("var decodedRoot = options.decodeDotInKeys ? cleanRoot.replace(/%2E/g, '.') : cleanRoot;\n","key = cleanRoot.replace(/%2E/g, '.');",0);
  assert.match(missing,/closest text in the file[\s\S]*1: var decodedRoot/);
  assert.equal(whereInFile("nothing alike here\n","zzz qqq",0),"");
  console.log("node-repair: a rejected find shows where the text really is");
}

// Half a fix (qs, 2026-11-12, two false successes): the same bug sat on a second line the test did not reach.
{
  const {similarUnchanged,siblingPrompt}=await import("../src/autonomy/node-repair.js");
  const patched=["    if (options.charsetSentinel) {","        if (charset === 'iso-8859-1') {","            prefix += 'utf8=%26%2310003%3B&';","        } else {","            prefix += 'utf8=%E2%9C%93'+options.delimiter;","        }","    }","    var joined = keys.join(options.delimiter);"].join("\n");
  const edit={path:"lib/stringify.js",find:"prefix += 'utf8=%E2%9C%93&';",replace:"prefix += 'utf8=%E2%9C%93'+options.delimiter;"};
  const found=similarUnchanged(patched,[edit]);
  assert.deepEqual(found.map(f=>f.line),[3],"the untouched twin line is found, nothing else");
  assert.match(siblingPrompt("sentinel ignores delimiter",[edit],found,"report"),/lib\/stringify\.js:3: prefix \+= 'utf8=%26%2310003%3B&';/);
  assert.deepEqual(similarUnchanged("a();\nb();\n",[{path:"x.js",find:"return total-percent;",replace:"return total*(1-percent/100);"}]),[],"no look-alikes, no extra step");
  console.log("node-repair: lines like the fixed one are checked before the job counts as done");
}

// The same text twice: a line number picks the occurrence (qs "objKeys = filter;", rejected again and again).
{
  const {nearestOccurrence,prepareRepair:prep}=await import("../src/autonomy/repair-engine.js");
  const fsx=await import("node:fs"),osx=await import("node:os"),px=await import("node:path");
  const text="a\n    objKeys = filter;\nb\nc\nd\n    objKeys = filter;\n";
  assert.equal(text.slice(nearestOccurrence(text,"objKeys = filter;",6)).split("\n")[0],"objKeys = filter;");
  assert.ok(nearestOccurrence(text,"objKeys = filter;",6)>nearestOccurrence(text,"objKeys = filter;",2));
  assert.equal(nearestOccurrence(text,"objKeys = filter;",90),-1,"too far from any occurrence");
  const dir=fsx.mkdtempSync(px.join(osx.tmpdir(),"line-"));fsx.writeFileSync(px.join(dir,"s.js"),text);
  const out=prep(dir,{cause:"c",edits:[{path:"s.js",find:"objKeys = filter;",replace:"objKeys = filter.slice();",line:6}]},{editable:/\.js$/});
  assert.equal(out.files[0]!.content,"a\n    objKeys = filter;\nb\nc\nd\n    objKeys = filter.slice();\n");
  assert.throws(()=>prep(dir,{cause:"c",edits:[{path:"s.js",find:"objKeys = filter;",replace:"x;"}]},{editable:/\.js$/}),/Add "line"/);
  fsx.rmSync(dir,{recursive:true,force:true});
  console.log("node-repair: a line number picks one of two identical lines");
}
