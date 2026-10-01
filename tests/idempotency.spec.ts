import {ToolExecutor} from "../src/tools/executor.js";
import {ToolRegistry} from "../src/tools/registry.js";
import {Sentinel} from "../src/security/sentinel.js";

const registry=new ToolRegistry();
registry.register({name:"echo",description:"echo",permission:"L1_READ",dangerous:false});
let calls=0;
const executor=new ToolExecutor(registry,new Sentinel());
const request={
  missionId:"m1",agentId:"a1",tool:"echo",action:"echo",
  permission:"L1_READ" as const,idempotencyKey:"same-key",payload:"hello"
};
const adapter={execute:async()=>{calls++;return"done";}};

const first=await executor.execute(request,adapter);
const second=await executor.execute(request,adapter);
if(!first.ok||!second.ok)throw new Error("Idempotent execution failed.");
if(calls!==1)throw new Error("Duplicate tool call was executed twice.");
if(second.verified!==true||second.data!=="done")throw new Error("Completed idempotent result was not replayed.");
console.log("Idempotency test passed.");
