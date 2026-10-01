import {LayanXCore} from "./core/orchestrator.js";
import type {AgentContract} from "./core/contracts.js";
import {configureProviders,providerSummary} from "./config/providers.js";
import {registerBuiltinTools,registerHttpReadTool,registerGitHubReadTools} from "./tools/builtin.js";
import {RuntimePersistence} from "./core/runtime-persistence.js";
import {RuntimeStorage} from "./storage/runtime-storage.js";

export interface RuntimeOptions{storagePath?:string;}

export function createRuntime(options:RuntimeOptions={}){
 const storagePath=options.storagePath??process.env.LAYANX_RUNTIME_STORAGE_PATH;
 const persistence=storagePath?new RuntimePersistence(RuntimeStorage.json(storagePath)):undefined;
 const core=new LayanXCore(undefined,persistence);
 registerBuiltinTools(core);
 registerHttpReadTool(core);
 registerGitHubReadTools(core,{token:process.env.GITHUB_TOKEN});
 const agent:AgentContract={
  agentId:"core",
  purpose:"Safely orchestrate LayanX missions.",
  allowedTools:["runtime.status","mission.inspect","memory.recall","http.read","github.repo.read","github.issues.list","github.prs.list"],
  forbiddenResources:["secrets","security-controls"],
  requiredPermission:"L1_READ",
  maxToolCalls:100,
  maxRuntimeMs:30000,
  successCriteria:["mission created","execution auditable"],
  stopCondition:"Stop on policy denial or Sentinel block."
 };
 core.registerAgent(agent);
 const configured=configureProviders(undefined,core.models,core.providers);
 return{core,...configured,providerSummary:providerSummary(),persistence};
}

export function runtimeStatus(runtime=createRuntime()){
 return{
  system:"LayanX AI",
  ready:runtime.core.isReady(),
  persistence:runtime.persistence?"configured":"disabled",
  providers:runtime.providerSummary,
  models:runtime.models.list().map(model=>({id:model.id,provider:model.provider,local:model.local,enabled:model.enabled,priority:model.priority}))
 };
}

export async function runtimeHealth(runtime=createRuntime()){
 const providers=await Promise.all(runtime.providers.list().map(provider=>provider.health()));
 let storage={healthy:true,writable:true,schemaVersion:1,reason:"Runtime persistence is disabled."};
 if(runtime.persistence){
  storage={healthy:true,writable:true,schemaVersion:1,reason:"Runtime persistence is configured."};
 }
 return{
  system:"LayanX AI",
  ready:runtime.core.isReady(),
  healthy:providers.length>0&&providers.every(provider=>provider.available)&&storage.healthy,
  storage,
  providers:providers.map(provider=>({
   provider:provider.provider,
   available:provider.available,
   latencyMs:provider.latencyMs,
   reason:provider.reason,
   updatedAt:provider.updatedAt
  }))
 };
}
