import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-project-create-"));
const previous=process.env.LAYANX_WORKSPACE_ROOT;
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
const {createSetupRoutes}=await import("../src/local/setup-routes.js");
const routes=createSetupRoutes({getSettings:()=>({workspaceRoot:process.env.LAYANX_WORKSPACE_ROOT})} as any);

const call=async(method:string,routePath:string,body?:unknown,loopback=true)=>{
  let status=0,data:any;
  await routes({method,url:new URL("http://127.0.0.1"+routePath),loopback,principal:{kind:"owner"},
    readJson:async()=>body,sendJson:(s:number,d:unknown)=>{status=s;data=d;}} as any);
  return{status,data};
};

try{
  const created=await call("POST","/v1/setup/projects/create",{name:"shop-site"});
  assert.equal(created.status,201);
  assert.equal(created.data.ok,true);
  const folder=path.join(process.env.LAYANX_WORKSPACE_ROOT!,"shop-site");
  assert.equal(created.data.project.path,folder);
  assert.equal(fs.statSync(folder).isDirectory(),true);
  assert.match(fs.readFileSync(path.join(folder,"README.md"),"utf8"),/# shop-site/);
  const metadata=JSON.parse(fs.readFileSync(path.join(folder,".layanx-project.json"),"utf8"));
  assert.equal(metadata.id,"shop-site");
  assert.equal(metadata.status,"new");

  const duplicate=await call("POST","/v1/setup/projects/create",{name:"shop-site"});
  assert.equal(duplicate.status,409,"duplicate creation must not merge into or overwrite an existing project");
  assert.equal(fs.readFileSync(path.join(folder,"README.md"),"utf8").includes("# shop-site"),true);

  const invalid=await call("POST","/v1/setup/projects/create",{name:"../outside"});
  assert.equal(invalid.status,400,"path traversal must be rejected");
  assert.equal(fs.existsSync(path.join(root,"outside")),false);

  const remote=await call("POST","/v1/setup/projects/create",{name:"remote-project"},false);
  assert.equal(remote.status,403,"project folders can only be created by the local owner");
  assert.equal(fs.existsSync(path.join(process.env.LAYANX_WORKSPACE_ROOT!,"remote-project")),false);
}finally{
  if(previous===undefined)delete process.env.LAYANX_WORKSPACE_ROOT;
  else process.env.LAYANX_WORKSPACE_ROOT=previous;
  fs.rmSync(root,{recursive:true,force:true});
}
console.log("project-create-route: isolated folders, metadata, duplicate protection, path traversal rejection, and local-only access passed");
