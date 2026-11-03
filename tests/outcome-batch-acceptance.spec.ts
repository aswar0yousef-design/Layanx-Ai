import assert from "node:assert/strict";
import {evaluateLocalAcceptance,summarizeLocalAcceptance,type LocalAcceptanceObserved,
  type IntegrityObserved,type LocalAcceptanceRecord} from "../src/autonomy/release-batch.js";

const checks=[
  "start","health","bilingual-home","create-task","list-task","restart",
  "persistent-create","delete-task","restart-after-delete","persistent-delete"
].map(name=>({name,ok:true}));
const workspace="C:\\test\\outcome-runs\\first\\projects\\acceptance-12345678";
const base:LocalAcceptanceObserved={
  id:"acceptance-12345678",jobId:"valid-job",workspace,ok:true,status:"completed",
  hasProject:true,hasDelivery:true,
  checkRefs:["project.run:test","project.run:build","independent:http:task-app","independent:ui:task-app"],
  independentBehavior:{ok:true,checks,blockers:[]},
  independentUI:{ok:true,checks:["browser-start","desktop-create","desktop-reload","desktop-delete","desktop-delete-reload","mobile-create","mobile-reload","mobile-delete","mobile-delete-reload"].map(name=>({name,ok:true})),blockers:[]}
};
const integrity:IntegrityObserved={ok:true,jobId:"valid-job",projectRoot:workspace,checkedFiles:6,blockers:[],warnings:[]};
const good=evaluateLocalAcceptance(base,integrity,workspace);
assert.equal(good.ok,true,JSON.stringify(good));
assert.equal(good.independentChecksPassed,10);
assert.equal(good.filesVerified,6);
const missingBuild=evaluateLocalAcceptance({...base,checkRefs:["project.run:test","independent:http:task-app"]},integrity,workspace);
assert.equal(missingBuild.ok,false);
assert.match(missingBuild.blockers.join(" "),/project\.run:build/);
const deceptive=evaluateLocalAcceptance({...base,independentBehavior:{ok:true,checks:checks.filter(c=>c.name!=="persistent-delete")}},integrity,workspace);
assert.equal(deceptive.ok,false);
assert.match(deceptive.blockers.join(" "),/persistent-delete/);
const duplicate=evaluateLocalAcceptance({...base,independentBehavior:{ok:true,checks:[...checks,checks[0]!]}},integrity,workspace);
assert.equal(duplicate.ok,false);
const missingUI=evaluateLocalAcceptance({...base,independentUI:{ok:false,checks:[],blockers:["missing Edge"]}},integrity,workspace);
assert.equal(missingUI.ok,false);
assert.match(missingUI.blockers.join(" "),/browser/);
const mismatched=evaluateLocalAcceptance(base,{...integrity,jobId:"different-job"},workspace);
assert.equal(mismatched.ok,false);
const warnings=evaluateLocalAcceptance(base,{...integrity,warnings:["Unhashed large file"]},workspace);
assert.equal(warnings.ok,false);
const claimed=evaluateLocalAcceptance({...base,ok:false},integrity,workspace);
assert.equal(claimed.ok,false);
const missing=evaluateLocalAcceptance(null,null,workspace);
assert.equal(missing.ok,false);
const make=(i:number):LocalAcceptanceRecord=>{
  const dir="C:\\test\\run-"+i;
  const observed={...base,jobId:"job-"+i,workspace:dir};
  const integrityObserved={...integrity,jobId:"job-"+i,projectRoot:dir};
  return {runFolder:dir,workspace:dir,exitCode:0,observed,integrity:integrityObserved,
    evaluation:evaluateLocalAcceptance(observed,integrityObserved,dir)};
};
const batch=Array.from({length:5},(_,i)=>make(i));
const all=summarizeLocalAcceptance(batch,5);
assert.equal(all.ok,true);
assert.equal(all.passed,5);
assert.equal(all.failed,0);
assert.equal(summarizeLocalAcceptance(batch.slice(0,4),5).ok,false);
assert.equal(summarizeLocalAcceptance([{...batch[0]!,exitCode:1},...batch.slice(1)],5).ok,false);
assert.equal(summarizeLocalAcceptance([batch[0]!,{...batch[1]!,observed:{...batch[1]!.observed,jobId:"job-0"}},...batch.slice(2)],5).ok,false);
assert.equal(summarizeLocalAcceptance(batch,6).ok,false);
console.log("outcome batch acceptance: missing evidence, incomplete behavior, changed delivery, duplicates and 5/5 release gate");
