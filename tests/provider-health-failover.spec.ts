import {ModelExecutionRouter,ModelProviderRegistry} from "../src/core/model-execution.js";
const models={find:()=>[
 {id:"primary",provider:"primary",capability:"text",enabled:true},
 {id:"fallback",provider:"fallback",capability:"text",enabled:true}
]} as any;
const providers=new ModelProviderRegistry();
providers.register({name:"primary",health:async()=>{throw new Error("health backend down");},generate:async()=>{throw new Error("should not execute");}} as any);
providers.register({name:"fallback",health:async()=>({provider:"fallback",available:true,updatedAt:new Date().toISOString()}),generate:async()=>({modelId:"fallback",provider:"fallback",output:"ok"})} as any);
const result=await new ModelExecutionRouter(models,providers).execute({capability:"text",input:"hello"});
if(result.output!=="ok"||result.attempts[0]?.error!=="Provider health check failed.")throw new Error("Provider health failure did not fail over safely.");
console.log("Provider health failover test passed.");