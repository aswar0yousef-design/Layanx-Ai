import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {writeDeliveryManifest} from "../src/autonomy/delivery.js";
import type {OutcomeReport} from "../src/autonomy/outcome.js";

const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-delivery-"));
const jobId="outcome-job-1";
const report:OutcomeReport={
  version:1,jobId,projectId:"delivery-project",verificationScope:"automated-gates",
  status:"verified",acceptanceCriteria:["App runs"],evidence:[],blockers:[],
  createdAt:"2026-10-30T00:00:00.000Z"
};
try{
  fs.mkdirSync(path.join(workspace,"src"),{recursive:true});
  fs.writeFileSync(path.join(workspace,"src","app.mjs"),"console.log('hello')");
  fs.writeFileSync(path.join(workspace,"package.json"),JSON.stringify({scripts:{test:"node --test",build:"node --check src/app.mjs",start:"node src/app.mjs"}}));
  fs.writeFileSync(path.join(workspace,".env"),"TEST_PRIVATE_FILE_SHOULD_NOT_BE_INDEXED");
  fs.mkdirSync(path.join(workspace,"node_modules"),{recursive:true});
  fs.writeFileSync(path.join(workspace,"node_modules","huge.js"),"unused");
  try{fs.symlinkSync(path.join(workspace,".env"),path.join(workspace,"external-secret-link"));}catch{}
  assert.throws(()=>writeDeliveryManifest(workspace,jobId,{...report,status:"blocked"}),/verified outcome/);
  const {manifest,relativePath,guideRelativePath}=writeDeliveryManifest(workspace,jobId,report);
  assert.equal(relativePath,".layanx/deliveries/"+jobId+".json");
  assert.equal(guideRelativePath,".layanx/deliveries/"+jobId+".md");
  const guide=fs.readFileSync(path.join(workspace,...guideRelativePath.split("/")),"utf8");
  assert.match(guide,/Scope: automated checks only/);
  assert.match(guide,/npm run test/);
  assert.equal(manifest.verificationScope,"automated-gates");
  assert.ok(manifest.artifacts.some(f=>f.path==="src/app.mjs"&&f.sha256?.length===64));
  assert.ok(manifest.commands.includes("npm run test"));
  assert.ok(manifest.commands.includes("npm run start"));
  assert.ok(manifest.artifacts.every(f=>!f.path.includes("node_modules")&&!f.path.includes(".env")&&!f.path.includes("secret-link")));
  const stored=JSON.parse(fs.readFileSync(path.join(workspace,...relativePath.split("/")),"utf8"));
  assert.equal(stored.jobId,jobId);
  assert.equal(stored.artifacts.length,manifest.artifacts.length);
  console.log("delivery manifest: verified gates, artifacts, secret exclusion, local persistence passed");
}finally{fs.rmSync(workspace,{force:true,recursive:true});}
