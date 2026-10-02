import {LayanXCore} from "./core/orchestrator.js";
import type {AgentContract} from "./core/contracts.js";
import {configureProviders,providerSummary} from "./config/providers.js";
import {registerBuiltinTools,registerHttpReadTool,registerGitHubReadTools,registerToolFabric} from "./tools/builtin.js";
import {RuntimePersistence} from "./core/runtime-persistence.js";
import {RuntimeStorage} from "./storage/runtime-storage.js";
import {PostgresStorageAdapter} from "./storage/postgres-adapter.js";

export interface RuntimeOptions{storagePath?:string;}

export function createRuntime(options:RuntimeOptions={}){
 const storagePath=options.storagePath??process.env.LAYANX_RUNTIME_STORAGE_PATH;
 const databaseUrl=process.env.LAYANX_DATABASE_URL??process.env.DATABASE_URL;
 const storage=databaseUrl?new RuntimeStorage(new PostgresStorageAdapter(databaseUrl)):storagePath?RuntimeStorage.json(storagePath):undefined;
 const persistence=storage?new RuntimePersistence(storage):undefined;
 const core=new LayanXCore(undefined,persistence);
 registerBuiltinTools(core);
 registerHttpReadTool(core);
 registerGitHubReadTools(core,{token:process.env.GITHUB_TOKEN});
 registerToolFabric(core);
 const agent:AgentContract={
  agentId:"core",
  purpose:"Safely orchestrate LayanX missions.",
  allowedTools:["runtime.status","mission.inspect","memory.recall","http.read","github.repo.read","github.issues.list","github.prs.list","browser.read","files.read","files.list","files.stat","files.write","terminal.exec","git.status","git.diff","git.log","git.checkpoint","git.branch","git.add","git.commit","git.rollback","git.push","project.inspect","project.verify","development.prepare"],
  forbiddenResources:["secrets","security-controls"],
  requiredPermission:"L4_EXECUTE",
  maxToolCalls:100,
  maxRuntimeMs:30000,
  successCriteria:["mission created","execution auditable","requested project operation completed"],
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
  const result=await runtime.persistence.health();
  storage={healthy:result.healthy,writable:result.writable,schemaVersion:1,reason:result.reason};
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
