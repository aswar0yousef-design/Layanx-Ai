import {LayanXCore} from "./core/orchestrator.js";
import type {AgentContract} from "./core/contracts.js";
import {configureProviders,providerSummary} from "./config/providers.js";

export function createRuntime(){
 const core=new LayanXCore();
 const agent:AgentContract={
  agentId:"core",
  purpose:"Safely orchestrate LayanX missions.",
  allowedTools:[],
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
