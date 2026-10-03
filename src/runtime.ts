import {LayanXCore} from "./core/orchestrator.js";
import type {AgentContract} from "./core/contracts.js";
import {configureProviders,providerSummary} from "./config/providers.js";
import {registerBuiltinTools,registerHttpReadTool,registerGitHubReadTools,registerToolFabric,registerDesktopControlTools} from "./tools/builtin.js";
import {RuntimePersistence} from "./core/runtime-persistence.js";
import {RuntimeStorage} from "./storage/runtime-storage.js";
import {PostgresStorageAdapter} from "./storage/postgres-adapter.js";
import {BusinessManager} from "./business/manager.js";
import {registerBusinessTools} from "./business/tools.js";
import {AdsManager} from "./business/ads.js";
import {MediaManager} from "./business/media.js";
import {LiveScreenObserver} from "./desktop/live-screen.js";
import {FreeCapacityProvider} from "./providers/free-capacity.js";
import {CreatorEngine} from "./creator/engine.js";
import {registerCreatorTools} from "./creator/tools.js";

export interface RuntimeOptions{storagePath?:string;}

export function createRuntime(options:RuntimeOptions={}){
 const storagePath=options.storagePath??process.env.LAYANX_RUNTIME_STORAGE_PATH;
 const databaseUrl=process.env.LAYANX_DATABASE_URL??process.env.DATABASE_URL;
 const storage=databaseUrl?new RuntimeStorage(new PostgresStorageAdapter(databaseUrl)):storagePath?RuntimeStorage.json(storagePath):undefined;
 const persistence=storage?new RuntimePersistence(storage):undefined;
 const core=new LayanXCore(undefined,persistence,storage);
 const business=new BusinessManager(undefined,async input=>(await core.modelExecution.execute({capability:"chat",input,maxOutputTokens:600,routing:{preferLocal:true}})).output);
 const ads=new AdsManager(business.store);
 const media=new MediaManager();
 const creator=new CreatorEngine({generateText:async input=>(await core.modelExecution.execute({capability:"chat",input,maxOutputTokens:800,routing:{preferLocal:true}})).output});
 registerBuiltinTools(core);
 registerHttpReadTool(core);
 registerGitHubReadTools(core,{token:process.env.GITHUB_TOKEN});
 registerToolFabric(core);
 registerDesktopControlTools(core);
 const liveScreen=new LiveScreenObserver({adapter:core.toolAdapters.get("desktop.screenshot"),intervalMs:Number(process.env.LAYANX_LIVE_SCREEN_INTERVAL_MS??500)});
 core.setLiveScreenObserver(liveScreen);
 registerBusinessTools(core,business,ads,media);
 registerCreatorTools(core,creator);
 const agent:AgentContract={
  agentId:"core",
  purpose:"Safely orchestrate LayanX missions.",
  allowedTools:["runtime.status","mission.inspect","memory.recall","http.read","github.repo.read","github.issues.list","github.prs.list","browser.read","files.read","files.list","files.stat","files.write","terminal.exec","git.status","git.diff","git.log","git.checkpoint","git.branch","git.add","git.commit","git.rollback","git.push","project.inspect","project.verify","development.prepare","desktop.status","desktop.mouse.move","desktop.mouse.click","desktop.keyboard.type","desktop.keyboard.press","desktop.screenshot","ads.snapshot","ads.account.create","ads.campaign.create","ads.adgroup.create","ads.creative.create","ads.ad.create","ads.campaign.launch","ads.campaign.pause","ads.insights.sync","commerce.snapshot","commerce.store.create","commerce.product.create","commerce.product.update","commerce.product.publish","commerce.orders.sync","media.add","media.inspect","content.generate","content.publish","content.schedule","content.process_scheduled","commerce.analytics","campaign.create","creator.doctor","creator.plan","creator.generate_assets","creator.render"],
  forbiddenResources:["secrets","security-controls"],
  requiredPermission:"L4_EXECUTE",
  maxToolCalls:100,
  maxRuntimeMs:30000,
  successCriteria:["mission created","execution auditable","requested project operation completed"],
  stopCondition:"Stop on policy denial or Sentinel block.",
  profile:{
   role:"orchestrator",
   description:"Coordinates missions, delegates work, and keeps execution within LayanX policy.",
   preferredCapabilities:["reasoning","chat"],
   memoryTags:["orchestration","missions","runtime"]
  }
 };
 core.registerAgent(agent);
 const configured=configureProviders(undefined,core.models,core.providers);
 return{core,business,ads,media,creator,liveScreen,...configured,providerSummary:providerSummary(),persistence};
}

export async function restoreRuntime(runtime:ReturnType<typeof createRuntime>):Promise<{restored:number}>{
 await runtime.business.hydrate();
 await runtime.core.scheduler.hydrate();
 if(!runtime.persistence)return{restored:0};
 const snapshots=await runtime.persistence.list();
 for(const snapshot of snapshots)runtime.core.restoreRuntimeSnapshot(snapshot);
 return{restored:snapshots.length};
}

type RuntimeStatusView=Pick<ReturnType<typeof createRuntime>,"core"|"persistence"|"models"|"providers"|"providerSummary">;
export function runtimeStatus(runtime:RuntimeStatusView=createRuntime()){
 return{
  system:"LayanX AI",
  ready:runtime.core.isReady(),
  persistence:runtime.persistence?"configured":"disabled",
  providers:runtime.providerSummary,
  models:runtime.models.list().map(model=>({id:model.id,provider:model.provider,providerModelId:model.providerModelId,local:model.local,enabled:model.enabled,priority:model.priority,tags:model.tags??[]})),
  freeCapacity:runtime.providers.list().filter(provider=>provider instanceof FreeCapacityProvider).map(provider=>(provider as FreeCapacityProvider).status())
 };
}

export async function runtimeHealth(runtime:Pick<ReturnType<typeof createRuntime>,"core"|"persistence"|"providers">=createRuntime()){
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
