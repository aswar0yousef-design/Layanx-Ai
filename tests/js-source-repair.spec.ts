import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {repairMultilineHtmlResponse} from "../src/autonomy/js-source-repair.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-html-repair-"));
const dir=path.join(root,"src");
const target=path.join(dir,"server.mjs");
const failure="build failed: "+target+":6\nSyntaxError: Invalid or unexpected token";
fs.mkdirSync(dir,{recursive:true});
try{
  const broken="import http from 'node:http';\nexport const createServer = () => http.createServer((req,res)=>{res.end('<html>\n<body lang=\\\"ar\\\">مرحبا</body>\n</html>')});\n";
  fs.writeFileSync(target,broken);
  assert.equal(spawnSync(process.execPath,["--check",target]).status===0,false,"Fixture must be invalid JS");
  const proposal=repairMultilineHtmlResponse(root,failure);
  assert.ok(proposal,"Should propose a verified fix for broken multiline HTML");
  assert.equal(proposal.path,"src/server.mjs");
  assert.equal(fs.readFileSync(target,"utf8"),broken,"Proposal must not write outside the audited runtime");
  fs.writeFileSync(target,proposal.content); // simulate approved files.write
  assert.equal(spawnSync(process.execPath,["--check",target]).status,0,"Node must accept proposed source");
  const fixed=fs.readFileSync(target,"utf8");
  assert.match(fixed,/res\.end\('<html>\\n<body/);
  assert.match(fixed,/<\/html>'\)/);
  assert.equal(repairMultilineHtmlResponse(root,failure),undefined,"Already valid code should not be rewritten");
  assert.equal(fs.readFileSync(target,"utf8"),fixed);
  const unrepairable="export const broken = () => {\n";
  fs.writeFileSync(target,unrepairable);
  assert.equal(repairMultilineHtmlResponse(root,failure),undefined,"Unrelated syntax failures must not be mutated");
  assert.equal(fs.readFileSync(target,"utf8"),unrepairable);
  const nestedBroken="res.end('<html>\n<body>OK</body>\n</html>');\nexport const invalid = ;\n";
  fs.writeFileSync(target,nestedBroken);
  assert.equal(repairMultilineHtmlResponse(root,failure),undefined,"An unverified repair must not persist");
  assert.equal(fs.readFileSync(target,"utf8"),nestedBroken,"Failed repair must roll back exactly");
  // A model-generated symlink must never let automatic repair mutate files
  // outside the isolated project. Symlink tests skip where Windows privileges
  // disallow creating symbolic links, without weakening the production guard.
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-repair-outside-"));
  const escaped=path.join(outside,"outside.mjs");
  try{
    fs.writeFileSync(escaped,broken);
    fs.unlinkSync(target);
    let linked=false;
    try{fs.symlinkSync(escaped,target,"file");linked=true;}catch{}
    if(linked){
      assert.equal(repairMultilineHtmlResponse(root,failure),undefined,"Symlink must not be repaired");
      assert.equal(fs.readFileSync(escaped,"utf8"),broken,"Outside file must remain untouched");
      fs.unlinkSync(target);
    }
  }finally{fs.rmSync(outside,{recursive:true,force:true});}
  fs.writeFileSync(target,broken);
  assert.equal(repairMultilineHtmlResponse(root,"test failed: unrelated"),undefined,"No syntax error signal, no mutation");
  assert.equal(fs.readFileSync(target,"utf8"),broken);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log("Syntax repair: fixes multiline HTML, independently verifies syntax, and rolls back invalid edits");
