import {ReleaseHealthProbe} from "../src/release/health-probe.js";

const healthy=new ReleaseHealthProbe([
 {name:"api",check:async()=>true},
 {name:"database",check:async()=>true}
]);
const ok=await healthy.run();
if(!ok.healthy||ok.results.some(r=>!r.healthy))throw new Error("Healthy probe reported failure.");

const failing=new ReleaseHealthProbe([
 {name:"api",check:async()=>false},
 {name:"database",check:async()=>{throw new Error("connection refused");}}
]);
const result=await failing.run();
if(result.healthy)throw new Error("Unhealthy probe was accepted.");
if(result.results.find(r=>r.name==="database")?.healthy!==false)throw new Error("Probe exception was not converted to a failed health check.");
if(!result.reason?.includes("api failed.")||!result.reason?.includes("database failed."))throw new Error("Probe failure reason was incomplete.");

console.log("Release health probe failure handling passed.");
