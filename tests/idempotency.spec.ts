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
const completed={
  key:"crash-boundary-key",missionId:"m2",agentId:"a1",tool:"echo",action:"echo",
  status:"completed" as const,createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),data:"durable-result"
};
const crashLikeService={
  async begin(){return{accepted:true,replay:false,record:{...completed,status:"running" as const}};},
  async complete(){throw new Error("acknowledgement lost after durable completion");},
  async fail(){throw new Error("record is already completed");},
  async get(){return completed;}
};
const crashExecutor=new ToolExecutor(registry,new Sentinel(),crashLikeService);
const crashResult=await crashExecutor.execute({...request,missionId:"m2",idempotencyKey:"crash-boundary-key"},adapter);
if(!crashResult.ok||crashResult.data!=="durable-result"||crashResult.replayed!==true)
  throw new Error("Durable completion boundary was not recovered.");

console.log("Idempotency test passed.");


const crashBeforeCompletionService={
  async begin(){return{accepted:true,replay:false,record:{...completed,status:"running" as const}};},
  async complete(){throw new Error("simulated acknowledgement loss");},
  async fail(){throw new Error("durable completion already exists");},
  async get(){return completed;},
  async list(){return[completed];},
  async restore(){}
};
const boundaryExecutor2=new ToolExecutor(registry,new Sentinel(),crashBeforeCompletionService);
const boundaryResult2=await boundaryExecutor2.execute(
  {...request,missionId:"m2",idempotencyKey:"crash-boundary-key"},
  adapter
);
if(!boundaryResult2.ok||boundaryResult2.verified!==true||boundaryResult2.data!=="durable-result"||boundaryResult2.replayed!==true)
  throw new Error("Recovery boundary replay failed.");
if(calls!==1)throw new Error("Recovery boundary re-executed a durably completed adapter.");
