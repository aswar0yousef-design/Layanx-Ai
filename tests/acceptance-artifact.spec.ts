import {strict as assert} from "node:assert";
import {test} from "node:test";
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyAcceptanceArtifact} from "../src/autonomy/acceptance-artifact.js";

test("acceptance artifact must exist inside the project",async()=>{
  const root=mkdtempSync(join(tmpdir(),"lx-acceptance-"));
  try{
    mkdirSync(join(root,"reports"));
    writeFileSync(join(root,"reports","result.json"),'{"passed":true}');
    assert.equal((await verifyAcceptanceArtifact(root,"reports/result.json")).ok,true);
    assert.equal((await verifyAcceptanceArtifact(root,"reports/missing.json")).ok,false);
    assert.equal((await verifyAcceptanceArtifact(root,"../outside.json")).ok,false);
    assert.equal((await verifyAcceptanceArtifact(root,root)).ok,false);
    assert.equal((await verifyAcceptanceArtifact(root,"reports")).ok,false);
    assert.equal((await verifyAcceptanceArtifact(root,"")).ok,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("symlinked evidence outside the project is rejected",async()=>{
  const root=mkdtempSync(join(tmpdir(),"lx-acceptance-root-"));
  const outside=mkdtempSync(join(tmpdir(),"lx-acceptance-out-"));
  try{
    writeFileSync(join(outside,"evidence.json"),"{}");
    // Windows CI may not permit file symlinks; junction directories do not
    // require the same privileges and still exercise realpath confinement.
    symlinkSync(outside,join(root,"linked"),process.platform==="win32"?"junction":"dir");
    assert.equal((await verifyAcceptanceArtifact(root,"linked/evidence.json")).ok,false);
  }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
