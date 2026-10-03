import {runtimeHealth,runtimeStatus} from "./runtime.js";
import type {createRuntime} from "./runtime.js";
import {FreeCapacityProvider} from "./providers/free-capacity.js";

type Runtime=ReturnType<typeof createRuntime>;
export interface ReadinessCheck{
  id:string;
  ok:boolean;
  blocking:boolean;
  detail:string;
}
export interface ReadinessGateResult{
  ready:boolean;
  reviewedTwice:boolean;
  checks:ReadinessCheck[];
  timestamp:string;
}

const requiredTools=["runtime.status","mission.inspect","memory.recall","project.inspect","terminal.exec","files.read","files.list","browser.read","desktop.status","desktop.screenshot"];

function structuralPass(runtime:Runtime):ReadinessCheck[]{
  const status=runtimeStatus(runtime);
  const models=runtime.models.list();
  const providers=runtime.providers.list();
  const checks:ReadinessCheck[]=[];
  const modelIds=new Set(models.map(model=>model.id));
  const providerNames=new Set(providers.map(provider=>provider.name));
  const duplicateModels=models.length!==modelIds.size;
  const duplicateProviders=providers.length!==providerNames.size;
  const missingProviderModels=models.filter(model=>!providerNames.has(model.provider));

  checks.push({id:"core-ready",ok:runtime.core.isReady(),blocking:true,detail:runtime.core.isReady()?"Core agent is registered.":"Core agent is not registered."});
  checks.push({id:"providers-present",ok:providers.length>0,blocking:true,detail:providers.length?providers.length+" provider(s) registered.":"No model providers are registered."});
  checks.push({id:"models-present",ok:models.length>0,blocking:true,detail:models.length?models.length+" model(s) registered.":"No models are registered."});
  checks.push({id:"unique-provider-identities",ok:!duplicateProviders,blocking:true,detail:duplicateProviders?"Duplicate provider names detected.":"Provider identities are unique."});
  checks.push({id:"unique-model-identities",ok:!duplicateModels,blocking:true,detail:duplicateModels?"Duplicate model ids detected.":"Model identities are unique."});
  checks.push({id:"model-provider-links",ok:missingProviderModels.length===0,blocking:true,detail:missingProviderModels.length?("Models reference missing providers: "+missingProviderModels.map(model=>model.id).join(", ")): "Every model has a registered provider."});
  const missingTools=requiredTools.filter(name=>!runtime.core.tools.list().some(tool=>tool.name===name));
  checks.push({id:"critical-tools",ok:missingTools.length===0,blocking:true,detail:missingTools.length?("Missing critical tools: "+missingTools.join(", ")): "Critical execution/observation tools are registered."});
  checks.push({id:"security-controls",ok:Boolean(runtime.core.permissions&&runtime.core.sentinel&&runtime.core.risk&&runtime.core.audit),blocking:true,detail:"Permission, Sentinel, risk and audit controls are initialized."});
  checks.push({id:"live-screen",ok:Boolean(runtime.liveScreen),blocking:false,detail:runtime.liveScreen?"Live-screen observer is configured.":"Live-screen observer is not configured."});
  checks.push({id:"persistence",ok:Boolean(runtime.persistence),blocking:false,detail:runtime.persistence?"Runtime persistence is configured.":"Runtime persistence is disabled; local ephemeral operation is still supported."});
  const freeProviders=providers.filter(provider=>provider instanceof FreeCapacityProvider).length;
  checks.push({id:"free-capacity",ok:true,blocking:false,detail:freeProviders?freeProviders+" free-capacity provider(s) registered.":"Free-capacity pool is not enabled; this is optional."});
  checks.push({id:"status-shape",ok:Boolean(status.system&&Array.isArray(status.models)&&Array.isArray(status.freeCapacity)),blocking:true,detail:"Runtime status surface is available."});
  return checks;
}

export async function runReadinessGate(runtime:Runtime=createRuntime()):Promise<ReadinessGateResult>{
  const first=structuralPass(runtime);
  const second=structuralPass(runtime);
  const structuralConsistent=JSON.stringify(first.map(check=>[check.id,check.ok,check.blocking]))===JSON.stringify(second.map(check=>[check.id,check.ok,check.blocking]));
  const checks=second.map(check=>({...check}));
  checks.push({id:"double-review-consistency",ok:structuralConsistent,blocking:true,detail:structuralConsistent?"Two structural review passes produced the same result.":"Structural review passes disagreed."});
  let healthError:string|undefined;
  try{
    const health=await runtimeHealth(runtime);
    checks.push({id:"provider-health",ok:health.providers.length>0&&health.providers.every(provider=>provider.available),blocking:true,detail:health.providers.every(provider=>provider.available)?"All registered providers are healthy.":health.providers.map(provider=>provider.provider+":"+provider.reason).join(" | ")});
    checks.push({id:"storage-health",ok:health.storage.healthy,blocking:Boolean(runtime.persistence),detail:health.storage.reason});
  }catch(error){
    healthError=error instanceof Error?error.message:"Runtime health check failed.";
  }
  if(healthError)checks.push({id:"runtime-health",ok:false,blocking:true,detail:healthError});
  const ready=checks.every(check=>!check.blocking||check.ok);
  return{ready,reviewedTwice:true,checks,timestamp:new Date().toISOString()};
}
