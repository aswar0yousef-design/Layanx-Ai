import {LayanXCore} from "./core/orchestrator.js";
import type {AgentContract} from "./core/contracts.js";
import {configureProviders,providerSummary} from "./config/providers.js";
import {registerBuiltinTools} from "./tools/builtin.js";

export function createRuntime(){
 const core=new LayanXCore();
 const agent:AgentContract={
  agentId:"core",
  purpose:"Safely orchestrate LayanX missions.",
  allowedTools:["runtime.status","mission.inspect","memory.recall"],
  forbiddenResources:["secrets","security-controls"],
  requiredPermission:"L1_READ",
  maxToolCalls:100,
  maxRuntimeMs:30000,
  successCriteria:["mission created","execution auditable"],
  stopCondition:"Stop on policy denial or Sentinel block."
 };
 core.registerAgent(agent);
 const configured=configureProviders(undefined,core.models,core.providers);
 return{core,...configured,providerSummary:providerSummary()};
}

export function runtimeStatus(runtime=createRuntime()){
 return{
  system:"LayanX AI",
  ready:runtime.core.isReady(),
  providers:runtime.providerSummary,
  models:runtime.models.list().map(model=>({id:model.id,provider:model.provider,local:model.local,enabled:model.enabled,priority:model.priority}))
 };
}

export async function runtimeHealth(runtime=createRuntime()){
 const providers=await Promise.all(runtime.providers.list().map(provider=>provider.health()));
 return{
  system:"LayanX AI",
  ready:runtime.core.isReady(),
  healthy:providers.length>0&&providers.every(provider=>provider.available),
  providers:providers.map(provider=>({
   provider:provider.provider,
   available:provider.available,
   latencyMs:provider.latencyMs,
   reason:provider.reason,
   updatedAt:provider.updatedAt
  }))
 };
}
