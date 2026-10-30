import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {verifyDeliveryManifest,writeDeliveryManifest} from "../src/autonomy/delivery.js";
import type {OutcomeReport} from "../src/autonomy/outcome.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-delivery-verify-"));
const jobId="deliverable-verified";
const outcome:OutcomeReport={
  version:1,jobId,projectId:"integrity-test",status:"verified",verificationScope:"automated-gates",
  acceptanceCriteria:["Files are present"],evidence:[],blockers:[],createdAt:new Date().toISOString()
};
try{
  fs.mkdirSync(path.join(root,"src"),{recursive:true});
  fs.mkdirSync(path.join(root,".layanx","outcomes"),{recursive:true});
  const file=path.join(root,"src","app.mjs");
  fs.writeFileSync(file,'console.log("working");');
  fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:"delivery-test",scripts:{test:"node --test"}}));
  fs.writeFileSync(path.join(root,".layanx","outcomes",jobId+".json"),JSON.stringify(outcome));
  const stored=writeDeliveryManifest(root,jobId,outcome);
  assert.ok(stored.manifest.artifacts.some(a=>a.path==="src/app.mjs"));
  const good=verifyDeliveryManifest(root,jobId);
  assert.equal(good.ok,true,JSON.stringify(good));
  assert.equal(good.checkedFiles,2);
  fs.writeFileSync(file,'console.log("modified");');
  const tampered=verifyDeliveryManifest(root,jobId);
  assert.equal(tampered.ok,false);
  assert.match(tampered.blockers.join(" "),/SHA-256 mismatch|size has changed/);
  fs.writeFileSync(file,'console.log("working");');
  fs.writeFileSync(path.join(root,"src","new.mjs"),"export const extra=true;");
  assert.match(verifyDeliveryManifest(root,jobId).blockers.join(" "),/Unlisted project artifact/);
  fs.rmSync(path.join(root,"src","new.mjs"));
  const json=path.join(root,...stored.relativePath.split("/"));
  const original=fs.readFileSync(json,"utf8");
  const malformed=JSON.parse(original) as {artifacts:Array<{path:string}>};
  malformed.artifacts[0]!.path="../outside.txt";
  fs.writeFileSync(json,JSON.stringify(malformed));
  const traversed=verifyDeliveryManifest(root,jobId);
  assert.equal(traversed.ok,false);
  assert.match(traversed.blockers.join(" "),/Invalid or duplicated artifact path/);
  fs.writeFileSync(json,original);
  const report=path.join(root,".layanx","outcomes",jobId+".json");
  fs.writeFileSync(report,JSON.stringify({...outcome,status:"blocked"}));
  const blocked=verifyDeliveryManifest(root,jobId);
  assert.equal(blocked.ok,false);
  assert.match(blocked.blockers.join(" "),/not independently recorded as verified/);
  console.log("delivery integrity: valid handoff, changed file, new file, traversal, blocked outcome checked");
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}
