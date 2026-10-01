import {ModelRegistry} from "../src/models/registry.js";
import {ModelRouter} from "../src/core/model-router.js";
import {ProviderHealthMonitor} from "../src/core/provider-health.js";
import {ProviderRegistry} from "../src/core/provider.js";
import {ProviderRouter} from "../src/core/provider-router.js";

const models=new ModelRegistry();
models.register({id:"primary-model",provider:"primary",capabilities:["chat"],local:false,enabled:true,priority:1});
models.register({id:"backup-model",provider:"backup",capabilities:["chat"],local:false,enabled:true,priority:2});

let primaryCalls=0;
let backupCalls=0;
const clients=new Map<string,{generate:()=>Promise<{provider:string;model:string;output:string}>}>([
 ["primary",{generate:async()=>{primaryCalls++;throw new Error("primary unavailable");}}],
 ["backup",{generate:async()=>{backupCalls++;return{provider:"backup",model:"backup-model",output:"fallback ok"};}}]
]);

const providers=new ProviderRegistry();
providers.register({name:"primary",health:async()=>({provider:"primary",available:true,updatedAt:new Date().toISOString()})});
providers.register({name:"backup",health:async()=>({provider:"backup",available:true,updatedAt:new Date().toISOString()})});

const result=await new ProviderRouter(new ModelRouter(models),clients as never,new ProviderHealthMonitor(providers)).generate("chat","hello");
if(result.provider!=="backup"||primaryCalls!==1||backupCalls!==1)throw new Error("Provider failover did not execute the backup provider.");

const unavailableProviders=new ProviderRegistry();
unavailableProviders.register({name:"primary",health:async()=>({provider:"primary",available:false,updatedAt:new Date().toISOString()})});
unavailableProviders.register({name:"backup",health:async()=>({provider:"backup",available:true,updatedAt:new Date().toISOString()})});
const healthGated=await new ProviderRouter(new ModelRouter(models),clients as never,new ProviderHealthMonitor(unavailableProviders)).generate("chat","hello");
if(healthGated.provider!=="backup"||primaryCalls!==1||backupCalls!==2)throw new Error("Unhealthy primary provider was not gated out.");

console.log("Provider failover and health-gating passed.");
