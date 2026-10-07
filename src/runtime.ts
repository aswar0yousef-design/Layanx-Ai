import {LayanXCore} from "./core/orchestrator.js";
import type {AgentContract} from "./core/contracts.js";
import {configureProviders,providerSummary} from "./config/providers.js";
import {registerBuiltinTools,registerHttpReadTool,registerGitHubReadTools,registerToolFabric,registerDesktopControlTools,registerTradingTools} from "./tools/builtin.js";
import {registerMt5TradingTools} from "./trading/mt5-agent-integration.js";
import {RuntimePersistence} from "./core/runtime-persistence.js";
import {RuntimeStorage} from "./storage/runtime-storage.js";
import {createOllamaEmbedder,embeddingModelFromEnv} from "./memory/embedder.js";
import {VectorStore} from "./memory/vector-store.js";
import {PostgresStorageAdapter} from "./storage/postgres-adapter.js";
import {BusinessManager} from "./business/manager.js";
import {registerBusinessTools} from "./business/tools.js";
import {AdsManager} from "./business/ads.js";
import {MediaManager} from "./business/media.js";
import {GrowthEngine} from "./business/growth-engine.js";
import {LiveScreenObserver} from "./desktop/live-screen.js";
import {FreeCapacityProvider} from "./providers/free-capacity.js";
import {CreatorEngine} from "./creator/engine.js";
import {registerCreatorTools} from "./creator/tools.js";
import {registerGoogleWorkspaceTools} from "./google-tools.js";
import {GoogleInvoiceAgent,registerGoogleInvoiceTool} from "./google-invoice-agent.js";
import {registerYahooMailTools} from "./yahoo-tools.js";
import {registerSkillLearningTools} from "./skills/tools.js";
import {registerAgentReachTools} from "./agent-reach-tools.js";
import {registerAutonomyTools,specialisedAgents} from "./autonomy/tools.js";
import {MessagingChannels} from "./channels/service.js";
import {FlowRuntime} from "./flows/runtime.js";
import {registerQuranTools,configureQuranDailySchedules} from "./quran/tools.js";
import {capabilityEnabled} from "./platform/capabilities.js";

export interface RuntimeOptions{storagePath?:string;}

export function createRuntime(options:RuntimeOptions={}){
 const storagePath=options.storagePath??process.env.LAYANX_RUNTIME_STORAGE_PATH;
 const databaseUrl=process.env.LAYANX_DATABASE_URL??process.env.DATABASE_URL;
 const storage=databaseUrl?new RuntimeStorage(new PostgresStorageAdapter(databaseUrl)):storagePath?RuntimeStorage.local(storagePath):undefined;
 const persistence=storage?new RuntimePersistence(storage):undefined;
 const core=new LayanXCore(undefined,persistence,storage);
 const embeddingModel=embeddingModelFromEnv();
 if(embeddingModel)core.memory.setEmbedder(createOllamaEmbedder(embeddingModel,{baseUrl:process.env.OLLAMA_BASE_URL}),VectorStore.forStore());
 const business=new BusinessManager(undefined,async input=>(await core.modelExecution.execute({capability:"chat",input,maxOutputTokens:600,routing:{preferLocal:true}})).output);
 const ads=new AdsManager(business.store);
 const media=new MediaManager();
 const growth=new GrowthEngine(business,undefined,async input=>(await core.modelExecution.execute({capability:"chat",input,maxOutputTokens:600,routing:{preferLocal:true}})).output);
 const creator=new CreatorEngine({generateText:async input=>(await core.modelExecution.execute({capability:"chat",input,maxOutputTokens:800,routing:{preferLocal:true}})).output});
 registerBuiltinTools(core);
 registerHttpReadTool(core);
 if(capabilityEnabled("coding"))registerGitHubReadTools(core,{token:process.env.GITHUB_TOKEN});
 registerToolFabric(core);
 registerAutonomyTools(core,{coding:capabilityEnabled("coding")});
 // Each role can be switched off from the setup page (LAYANX_CAPABILITIES); fewer tools = better local-model choices.
 if(capabilityEnabled("trading")){
  registerTradingTools(core,core.trading,core.strategies);
  const mt5Scalper=registerMt5TradingTools(core.tools,core.toolAdapters);
  if(process.env.MT5_AUTO_START==="true"&&process.env.MT5_AUTO_SCALPING_ENABLED==="true"&&process.env.MT5_LIVE_TRADING_ENABLED==="true")mt5Scalper.start();
 }
 if(capabilityEnabled("desktop"))registerDesktopControlTools(core);
 const liveScreen=new LiveScreenObserver({adapter:core.toolAdapters.get("desktop.screenshot"),intervalMs:Number(process.env.LAYANX_LIVE_SCREEN_INTERVAL_MS??500)});
 core.setLiveScreenObserver(liveScreen);
 if(capabilityEnabled("business")||capabilityEnabled("ads")||capabilityEnabled("social"))registerBusinessTools(core,business,ads,media,growth);
 if(capabilityEnabled("social"))registerCreatorTools(core,creator);
 if(capabilityEnabled("quran"))registerQuranTools(core);
 if(capabilityEnabled("email")){
  registerGoogleWorkspaceTools(core,{accessToken:process.env.GOOGLE_ACCESS_TOKEN,clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,refreshToken:process.env.GOOGLE_REFRESH_TOKEN});
  registerGoogleInvoiceTool(core,new GoogleInvoiceAgent(core));
  registerYahooMailTools(core);
 }
 registerSkillLearningTools(core);
 if(capabilityEnabled("research"))registerAgentReachTools(core);
 let channels!: MessagingChannels;
 const flows=new FlowRuntime(core,async(channel,chatId,text)=>{if(channel==="whatsapp")await channels.whatsapp.sendText(chatId,text);else if(channel==="telegram")await channels.telegram.sendText(chatId,text);});
 channels=new MessagingChannels(core,async message=>{const raw=message.raw&&typeof message.raw==="object"?message.raw as Record<string,unknown>:{};const projectId=process.env.LAYANX_CHANNEL_PROJECT_ID??"default"; /* never taken from the inbound message itself */const result=await flows.handleInbound({id:message.messageId,projectId,channel:message.channel,senderId:message.senderId,chatId:message.chatId,text:message.text,timestamp:new Date().toISOString(),metadata:{...raw,eventType:"message"}});return result.matched>0;});
 const agent:AgentContract={
  agentId:"core",
  purpose:"Safely orchestrate LayanX missions.",
  allowedTools:["runtime.status","mission.inspect","memory.recall","http.read","github.repo.read","github.issues.list","github.prs.list","browser.read","files.read","files.list","files.stat","files.write","project.bootstrap","project.verify","terminal.exec","git.status","git.diff","git.log","git.checkpoint","git.branch","git.add","git.commit","git.rollback","git.push","project.inspect","project.verify","development.prepare","desktop.status","desktop.mouse.move","desktop.mouse.click","desktop.mouse.scroll","desktop.keyboard.type","desktop.keyboard.press","desktop.screenshot","desktop.ui.tree","desktop.ui.click","desktop.ui.set_text","desktop.window.focus","ads.snapshot","ads.account.create","ads.campaign.create","ads.adgroup.create","ads.creative.create","ads.ad.create","ads.campaign.launch","ads.campaign.pause","ads.insights.sync","commerce.snapshot","commerce.store.create","commerce.product.create","commerce.product.update","commerce.product.publish","commerce.orders.sync","media.add","media.inspect","content.generate","content.publish","content.schedule","content.process_scheduled","commerce.analytics","campaign.create","growth.snapshot","growth.dashboard","growth.experiment.create","growth.plan_cycle","growth.metric.record","growth.action.complete","creator.doctor","creator.plan","creator.generate_assets","creator.render","quran.doctor","quran.prepare_next","quran.publish_next","google.gmail.search","google.gmail.read","google.gmail.send","google.drive.list","google.drive.folder.create","google.sheets.create","google.sheets.append","google.calendar.upcoming","google.merchant.accounts","google.merchant.products","email.invoices.scan","yahoo.mail.search","yahoo.mail.read","yahoo.mail.send","skill.learn","skill.pending","skill.approve","skill.enable","skill.execute","trading.paper.backtest","trading.binance.market-data","trading.binance.order",
   // Registered by their subsystems but previously missing here, so the agent could never choose them.
   // Dangerous ones (orders, MT5 auto-scalper, setup) still stop for explicit approval.
   "research.internet","agent-reach.status","agent-reach.channels","agent-reach.collect","agent-reach.capabilities","agent-reach.update.check","agent-reach.setup",
   "trading.strategy.list","trading.strategy.backtest","trading.strategy.optimize","trading.strategy.walk_forward","trading.strategy.monte_carlo",
   "trading.account","trading.quote","trading.order.place","trading.position.close",
   "trading.mt5.account","trading.mt5.autoscalper.status","trading.mt5.autoscalper.start","trading.mt5.autoscalper.stop",
   "google.sheets.read","google.drive.file.organize",
   "project.run","browser.test","agent.external","project.knowledge","project.knowledge.record","project.security","git.merge","git.publish_pr","learning.search","learning.record"],
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
 for(const specialised of specialisedAgents(agent))core.registerAgent(specialised);
 const configured=configureProviders(undefined,core.models,core.providers);
 return{core,business,ads,media,growth,creator,liveScreen,channels,flows,...configured,providerSummary:providerSummary(),persistence};
}

export async function restoreRuntime(runtime:ReturnType<typeof createRuntime>):Promise<{restored:number}>{
 await runtime.business.hydrate();
 await runtime.core.scheduler.hydrate();
 if(process.env.LAYANX_QURAN_AUTOSCHEDULE==="true"&&capabilityEnabled("quran"))configureQuranDailySchedules(runtime.core);
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
