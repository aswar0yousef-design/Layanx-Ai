import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import type {BusinessManager} from "./manager.js";
import type {AdsManager} from "./ads.js";
import type {MediaManager} from "./media.js";

export function registerBusinessTools(core:LayanXCore,business:BusinessManager,ads:AdsManager,media?:MediaManager){
 const defs=[
  ["ads.snapshot","read paid advertising state","L1_READ",false],
  ["ads.account.create","create an advertising account connection","L3_MODIFY",false],
  ["ads.campaign.create","create a paid campaign draft","L3_MODIFY",false],
  ["ads.adgroup.create","create an ad group draft","L3_MODIFY",false],
  ["ads.creative.create","create an ad creative","L3_MODIFY",false],
  ["ads.ad.create","create a paid ad draft","L3_MODIFY",false],
  ["ads.campaign.launch","launch a paid campaign on the platform","L4_EXECUTE",true],
  ["ads.campaign.pause","pause a paid campaign","L4_EXECUTE",true],
  ["ads.insights.sync","sync advertising performance metrics","L2_ANALYZE",false],
  ["commerce.snapshot","read commerce and marketing state","L1_READ",false],
  ["commerce.store.create","create a store connection","L3_MODIFY",false],
  ["commerce.product.create","create a product","L3_MODIFY",false],
  ["commerce.product.update","update a product","L3_MODIFY",false],
  ["commerce.product.publish","publish a product to its connected store","L4_EXECUTE",true],
  ["commerce.orders.sync","sync orders from a connected store","L3_MODIFY",false],
  ["media.add","register an externally hosted media asset","L3_MODIFY",false],
  ["media.inspect","inspect remote media reachability and metadata","L1_READ",false],
  ["content.generate","generate a first-draft product post","L2_ANALYZE",false],
  ["content.publish","publish approved content to configured social accounts","L4_EXECUTE",true],
  ["content.schedule","schedule approved content for publication","L3_MODIFY",false],
  ["content.process_scheduled","publish due approved scheduled content","L4_EXECUTE",true],
  ["commerce.analytics","read business operating metrics","L1_READ",false],
  ["campaign.create","create a campaign","L3_MODIFY",false]
 ] as const;
 const handlers:Record<string,(p:any)=>Promise<unknown>|unknown>={
  "ads.snapshot":()=>ads.snapshot(),
  "ads.account.create":p=>ads.addAccount(p),
  "ads.campaign.create":p=>ads.createCampaign(p),
  "ads.adgroup.create":p=>ads.createAdGroup(p),
  "ads.creative.create":p=>ads.createCreative(p),
  "ads.ad.create":p=>ads.createAd(p),
  "ads.campaign.launch":p=>ads.launchCampaign(String(p.campaignId)),
  "ads.campaign.pause":p=>ads.pauseCampaign(String(p.campaignId)),
  "ads.insights.sync":p=>ads.syncInsights(String(p.accountId),p.campaignId?String(p.campaignId):undefined),
  "commerce.snapshot":()=>business.snapshot(),
  "commerce.store.create":p=>business.createStore(p),
  "commerce.product.create":p=>business.createProduct(p),
  "commerce.product.update":p=>business.updateProduct(String(p.id),p.patch??{}),
  "commerce.product.publish":p=>business.publishProduct(String(p.productId)),
  "commerce.orders.sync":p=>business.syncOrders(String(p.storeId)),
  "media.add":p=>business.addMedia(p),
  "media.inspect":p=>{if(!media)throw new Error("media_manager_not_configured");return media.inspect(String(p.url));},
  "content.generate":p=>business.generateProductContentAI(String(p.productId),p.platforms),
  "content.publish":p=>business.publishContent(String(p.contentId)),
  "content.schedule":p=>business.scheduleContent(String(p.contentId),String(p.scheduledAt)),
  "content.process_scheduled":()=>business.processScheduledContent(),
  "commerce.analytics":()=>business.analytics(),
  "campaign.create":p=>business.createCampaign(p)
 };
 for(const [name,description,permission,dangerous] of defs){
  const handler=handlers[name];if(!handler)throw new Error(`business_handler_missing:${name}`);
  core.tools.register({name,description,permission:permission as any,dangerous,actions:[name],tags:["business",name.split(".")[0]??"business"]});
  const adapter:ToolAdapter={async execute(request){return handler(request.payload??{});}};
  core.toolAdapters.register(name,adapter);
 }
}
