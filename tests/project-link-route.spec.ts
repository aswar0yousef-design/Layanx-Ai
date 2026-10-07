import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// POST /v1/projects/link never hands an existing project's trust, isolation or folder to another folder.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-link-route-"));
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"workspace");
process.env.LAYANX_PROJECTS_FILE=path.join(root,"projects.json");
process.env.LAYANX_TRUST_FILE=path.join(root,"trust.json");
process.env.LAYANX_ISOLATION_FILE=path.join(root,"isolation.json");
fs.mkdirSync(path.join(process.env.LAYANX_WORKSPACE_ROOT,"shop"),{recursive:true});
const {createSetupRoutes}=await import("../src/local/setup-routes.js");
const {setTrust}=await import("../src/autonomy/trust.js");
const routes=createSetupRoutes({} as any);

const call=async(method:string,body?:unknown)=>{
  let status=0,data:any;
  await routes({method,url:new URL("http://127.0.0.1/v1/projects/link"),loopback:true,principal:{kind:"owner"},
    readJson:async()=>body,sendJson:(s:number,d:unknown)=>{status=s;data=d;}} as any);
  return{status,data};
};
const folder=(name:string)=>{const p=path.join(root,"code",name);fs.mkdirSync(p,{recursive:true});return p;};

// 1. A new name for a new folder links.
const a=folder("alpha");
assert.equal((await call("POST",{projectId:"alpha",path:a})).status,200);
assert.equal((await call("POST",{projectId:"alpha",path:a})).status,200,"same folder again is fine");
// 2. The name is linked to another folder: 409, unless the owner replaces it on purpose.
const b=folder("beta");
const taken=await call("POST",{projectId:"alpha",path:b});
assert.equal(taken.status,409);assert.equal(taken.data.error,"project_id_taken");assert.equal(taken.data.path,path.resolve(a));
assert.equal((await call("POST",{projectId:"alpha",path:b,replace:true})).status,200);
// 3. Not linked, but a project folder of that name exists in the projects folder.
const shop=await call("POST",{projectId:"shop",path:folder("shop")});
assert.equal(shop.status,409,"another folder named shop does not take over the shop project");
assert.match(shop.data.message,/already used by/);
// 4. Not linked, no folder, but trust settings exist for the name.
setTrust(process.env.LAYANX_TRUST_FILE,"store","full");
const store=await call("POST",{projectId:"store",path:folder("store")});
assert.equal(store.status,409,"a folder never inherits another project's full trust");
assert.match(store.data.message,/own trust or isolation settings/);
// 5. Linking the project's own folder in the projects folder is not a takeover.
assert.equal((await call("POST",{projectId:"shop",path:path.join(process.env.LAYANX_WORKSPACE_ROOT,"shop")})).status,200);

fs.rmSync(root,{recursive:true,force:true});
console.log("project-link-route: names linked elsewhere, project folders and trust/isolation settings are never taken over silently");
