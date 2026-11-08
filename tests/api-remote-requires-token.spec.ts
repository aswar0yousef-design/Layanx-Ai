import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import type {AddressInfo} from "node:net";
import {startRuntimeApi} from "../src/api-server.js";
import {createRuntime} from "../src/runtime.js";

// Staging found /v1/status open on a 0.0.0.0 bind: the global token gate needed a separate opt-in.
const runtime=createRuntime({storagePath:path.join(os.tmpdir(),"layanx-remote-token-"+process.pid+".json")});
const options={core:runtime.core,business:runtime.business,ads:runtime.ads,host:"0.0.0.0",port:0};
assert.throws(()=>startRuntimeApi(options),/LAYANX_API_TOKEN is required/,"a remote bind must not start without a token");
const server=startRuntimeApi({...options,token:"remote-test"});
try{
  if(!server.listening)await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  for(const route of ["/v1/status","/v1/system/load"]){
    assert.equal((await fetch(base+route)).status,401,route+" must reject a missing token");
    assert.equal((await fetch(base+route,{headers:{authorization:"Bearer wrong"}})).status,401,route+" must reject a wrong token");
  }
  assert.equal((await fetch(base+"/v1/status",{headers:{authorization:"Bearer remote-test"}})).status,200);
  assert.notEqual((await fetch(base+"/v1/health")).status,401,"health stays public for probes");
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
console.log("remote API bind: token enforced on every non-public route");
process.exit(0);
