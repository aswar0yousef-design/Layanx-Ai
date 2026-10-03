import {createRuntime,runtimeHealth} from "./runtime.js";
import {runReadinessGate,type ReadinessCheck} from "./readiness.js";

export interface OperationalAcceptanceOptions{
  requireLiveProviders?:boolean;
}

export interface OperationalAcceptanceResult{
  accepted:boolean;
  strict:boolean;
  reviewedTwice:boolean;
  checks:ReadinessCheck[];
  providerHealth:Awaited<ReturnType<typeof runtimeHealth>>;
  timestamp:string;
}

function duplicateNames(values:string[]):string[]{
  const seen=new Set<string>(); const duplicates=new Set<string>();
  for(const value of values){if(seen.has(value))duplicates.add(value);seen.add(value);}
  return [...duplicates];
}

export async function runOperationalAcceptance(
  runtime:ReturnType<typeof createRuntime>=createRuntime(),
  options:OperationalAcceptanceOptions={}
):Promise<OperationalAcceptanceResult>{
  const strict=options.requireLiveProviders??process.env.LAYANX_OPERATIONAL_REQUIRE_LIVE_PROVIDERS==="true";
  const readiness=await runReadinessGate(runtime);
  const checks=readiness.checks.map(check=>{
    if(!strict&&(check.id==="provider-health"||check.id==="runtime-health"))
      return{...check,blocking:false};
    return{...check};
  });

  const tools=runtime.core.tools.list();
  const models=runtime.models.list();
  const providers=runtime.providers.list();
  const duplicateTools=duplicateNames(tools.map(tool=>tool.name));
  const duplicateModels=duplicateNames(models.map(model=>model.id));
  const duplicateProviders=duplicateNames(providers.map(provider=>provider.name));

  checks.push({
    id:"unique-tool-identities",
    ok:duplicateTools.length===0,
    blocking:true,
    detail:duplicateTools.length?("Duplicate tool names detected: "+duplicateTools.join(", ")): "Tool identities are unique."
  });
  checks.push({
    id:"acceptance-runtime-contract",
    ok:Boolean(runtime.core.isReady()&&tools.length>0&&models.length>0&&providers.length>0),
    blocking:true,
    detail:"Core, tools, models and providers are all present."
  });
  checks.push({
    id:"acceptance-no-duplicate-registration",
    ok:duplicateTools.length===0&&duplicateModels.length===0&&duplicateProviders.length===0,
    blocking:true,
    detail:"No duplicate registration exists across tools, models or providers."
  });

  const providerHealth=await runtimeHealth(runtime);
  const liveOk=providerHealth.providers.length>0&&providerHealth.providers.every(provider=>provider.available);
  checks.push({
    id:"live-provider-gate",
    ok:liveOk,
    blocking:strict,
    detail:liveOk?"All registered providers are reachable.":strict
      ?"Strict acceptance requires every registered provider to be reachable."
      :"Live provider availability is external to CI; run strict acceptance on the target machine."
  });

  const accepted=checks.every(check=>!check.blocking||check.ok);
  return{
    accepted,
    strict,
    reviewedTwice:readiness.reviewedTwice,
    checks,
    providerHealth,
    timestamp:new Date().toISOString()
  };
}
