import {ModelRegistry} from "../src/models/registry.js";
import {FailoverRouter} from "../src/core/failover-router.js";
const registry=new ModelRegistry();
registry.register({id:"broken",provider:"broken",capabilities:["chat"],local:false,enabled:true,priority:1});
registry.register({id:"backup",provider:"backup",capabilities:["chat"],local:true,enabled:true,priority:2});
const clients=new Map<string,{generate:(r:any)=>Promise<any>}>([
 ["broken",{generate:async()=>{throw new Error("offline");}}],
 ["backup",{generate:async r=>({provider:"backup",model:r.model,output:"fallback"})}]
]);
const result=await new FailoverRouter(registry,clients).generate("chat","hello");
if(result.provider!=="backup")throw new Error("Failover did not select backup provider.");
console.log("Failover test passed.");
