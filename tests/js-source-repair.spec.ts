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
  const browserScript="const render = task => `<li>${task.title}</li>`;";
  const mixed='res.end(`<html lang="${lang}"><script>'+browserScript+'</script></html>`);';
  fs.writeFileSync(target,mixed);
  const syntax=spawnSync(process.execPath,["--check",target],{encoding:"utf8"});
  assert.notEqual(syntax.status,0);
  const mixedProposal=repairMultilineHtmlResponse(root,syntax.stderr);
  assert.ok(mixedProposal);
  let html="";
  new Function("res","lang",mixedProposal.content)({end:(value:string)=>{html=value;}},"ar");
  assert.equal(html,'<html lang="ar"><script>'+browserScript+'</script></html>');
  assert.equal(fs.readFileSync(target,"utf8"),mixed);
  const withDoctype=mixed.replace("<html","\n<!DOCTYPE html>\n<html");
  fs.writeFileSync(target,withDoctype);
  const doctypeSyntax=spawnSync(process.execPath,["--check",target],{encoding:"utf8"});
  assert.notEqual(doctypeSyntax.status,0);
  const doctypeProposal=repairMultilineHtmlResponse(root,doctypeSyntax.stderr);
  assert.ok(doctypeProposal);
  new Function("res","lang",doctypeProposal.content)({end:(value:string)=>{html=value;}},"ar");
  assert.equal(html,'\n<!DOCTYPE html>\n<html lang="ar"><script>'+browserScript+'</script></html>');
  const withServerTemplate=mixed.replace("<script>",'<ul>${items.map(item => `<li>${item}</li>`).join("")}</ul><script>');
  fs.writeFileSync(target,withServerTemplate);
  const serverSyntax=spawnSync(process.execPath,["--check",target],{encoding:"utf8"});
  assert.notEqual(serverSyntax.status,0);
  const serverProposal=repairMultilineHtmlResponse(root,serverSyntax.stderr);
  assert.ok(serverProposal);
  new Function("res","lang","items",serverProposal.content)({end:(value:string)=>{html=value;}},"ar",["مهام"]);
  assert.equal(html,'<html lang="ar"><ul><li>مهام</li></ul><script>'+browserScript+'</script></html>');
  // The page held in a constant, as in the structure given to the model.
  const pageConstant="const page=`<!doctype html><html><body><script>\nfetch(`/tasks/${task.id}`,{method:'DELETE'});\n</script></body></html>`;\nres.end(page);";
  fs.writeFileSync(target,pageConstant);
  const pageSyntax=spawnSync(process.execPath,["--check",target],{encoding:"utf8"});
  assert.notEqual(pageSyntax.status,0);
  const pageProposal=repairMultilineHtmlResponse(root,pageSyntax.stderr);
  assert.ok(pageProposal,"A nested backtick in a page constant should be repaired: "+pageSyntax.stderr);
  new Function("res",pageProposal.content)({end:(value:string)=>{html=value;}});
  assert.ok(html.includes("fetch(`/tasks/${task.id}`,{method:'DELETE'});"),html);
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
