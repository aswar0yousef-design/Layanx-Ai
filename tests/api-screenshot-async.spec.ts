import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-screenshot-api-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
const project=path.join(process.env.LAYANX_WORKSPACE_ROOT,"image-test");
const screens=path.join(project,".layanx","screens");
fs.mkdirSync(screens,{recursive:true});
const expected=Buffer.from([0xff,0xd8,0xff,0x00,0x01,0x02]);
fs.writeFileSync(path.join(screens,"sample.jpg"),expected);

const {startRuntimeApi}=await import("../src/api-server.js");
const {LayanXCore}=await import("../src/core/orchestrator.js");
const server=startRuntimeApi({core:new LayanXCore(),host:"127.0.0.1",port:0});
await new Promise<void>(resolve=>server.on("listening",resolve));
const address=server.address();
if(!address||typeof address==="string")throw new Error("API server did not bind.");
const base="http://127.0.0.1:"+address.port;

try{
 const image=await fetch(base+"/v1/projects/image-test/screens/sample.jpg");
 assert.equal(image.status,200);
 assert.equal(image.headers.get("content-type"),"image/jpeg");
 assert.equal(image.headers.get("cache-control"),"no-store");
 assert.equal(image.headers.get("x-content-type-options"),"nosniff");
 assert.deepEqual(Buffer.from(await image.arrayBuffer()),expected,"image bytes are returned unchanged");

 const missing=await fetch(base+"/v1/projects/image-test/screens/missing.jpg");
 assert.equal(missing.status,404);
 assert.deepEqual(await missing.json(),{ok:false,error:"not_found"});

 const invalid=await fetch(base+"/v1/projects/image-test/screens/%2E%2E%2FPROJECT.md");
 assert.equal(invalid.status,400,"encoded traversal attempts must be rejected");
 console.log("Asynchronous project screenshot API test passed.");
}finally{
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 fs.rmSync(root,{recursive:true,force:true});
}
