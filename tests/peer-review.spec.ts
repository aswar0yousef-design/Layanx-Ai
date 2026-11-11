import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {agreedCases,parseReviewCases,reviewTestSource,secondOpinionPrompt} from "../src/autonomy/peer-review.js";
import {nodeSpecFiles} from "../src/autonomy/project-build.js";

const c=(args:string[],code:number,stdout:string)=>({args,stdin:"",code,stdout,why:"w"});
// A malformed review is unusable, and it is capped.
assert.throws(()=>parseReviewCases({}),/invalid JSON/);
assert.equal(parseReviewCases({cases:[{args:["1"],code:0,stdout:"a"},{args:["2"],code:0,stdout:"b"},{args:["3"],code:0,stdout:"c"},{args:["4"],code:0,stdout:"d"}]}).length,3);
assert.equal(parseReviewCases({cases:[{args:"nope",code:0,stdout:"a"}]}).length,0);
// Only cases both models agree on survive. JSON spacing does not matter; error wording does not matter.
const cases=[c(["40"],0,"XL"),c(["5"],0,"V"),c(["0"],1,"bad"),c(["j"],0,'{"a":1}')];
const kept=agreedCases(cases,{answers:[{code:0,stdout:"XL\n"},{code:0,stdout:"VI"},{code:1,stdout:"something else"},{code:0,stdout:'{ "a": 1 }'}]});
assert.deepEqual(kept.map(k=>k.args[0]),["40","0","j"]);
assert.throws(()=>agreedCases(cases,{}),/invalid JSON/);
assert.equal(agreedCases(cases,{answers:[]}).length,0);
// The second opinion never sees the program or the reviewer's expected output.
const prompt=secondOpinionPrompt("goal",[c(["40"],0,"SECRET-EXPECTED")]);
assert.equal(prompt.includes("SECRET-EXPECTED"),false);
// A generated review test really passes on correct code and fails on wrong code.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-review-"));
try{
  fs.mkdirSync(path.join(dir,"src"));fs.mkdirSync(path.join(dir,"tests"));
  for(const file of nodeSpecFiles("x",`import test from 'node:test';import assert from 'node:assert/strict';\nimport {cli} from './helpers.mjs';\ntest('a',async()=>assert.ok(await cli()));test('b',async()=>assert.ok(await cli()));test('c',async()=>assert.ok(await cli()));test('d',async()=>assert.ok(await cli()));`).filter(f=>f.path==="package.json"||f.path.endsWith("helpers.mjs")))fs.writeFileSync(path.join(dir,file.path),file.content);
  fs.writeFileSync(path.join(dir,"tests/review.test.mjs"),reviewTestSource([c(["40"],0,"XL"),c(["0"],1,"")]));
  const run=(program:string)=>{fs.writeFileSync(path.join(dir,"src/index.mjs"),program);return spawnSync(process.execPath,["--test"],{cwd:dir,encoding:"utf8",windowsHide:true}).status;};
  assert.equal(run("const n=process.argv[2];if(n==='0'){console.error('bad');process.exitCode=1;}else console.log('XL');"),0);
  assert.notEqual(run("console.log('XXXX');"),0);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log("peer-review: only objections two models agree on become tests, and the tests judge the program");
