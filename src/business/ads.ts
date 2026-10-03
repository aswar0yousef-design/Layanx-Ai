import {randomUUID} from "node:crypto";
import type {BusinessSnapshot} from "./types.js";
import {BusinessStore} from "./store.js";

export type AdPlatform="meta"|"tiktok"|"google"|"x";
export type AdStatus="draft"|"active"|"paused"|"completed"|"failed";
export interface AdAccount{id:string;platform:AdPlatform;name:string;accountId:string;currency:string;enabled:boolean;createdAt:string;}
export interface PaidCampaign{id:string;accountId:string;name:string;objective:string;status:AdStatus;dailyBudget?:number;totalBudget?:number;currency:string;startAt?:string;endAt?:string;externalId?:string;createdAt:string;updatedAt:string;}
export interface AdGroup{id:string;campaignId:string;name:string;status:AdStatus;targeting:Record<string,unknown>;dailyBudget?:number;externalId?:string;createdAt:string;updatedAt:string;}
export interface AdCreative{id:string;name:string;headline?:string;body?:string;destinationUrl?:string;mediaIds:string[];metadata:Record<string,unknown>;externalId?:string;createdAt:string;updatedAt:string;}
export interface PaidAd{id:string;adGroupId:string;creativeId:string;name:string;status:AdStatus;externalId?:string;createdAt:string;updatedAt:string;}
export interface AdMetric{id:string;platform:AdPlatform;accountId:string;campaignId:string;date:string;impressions:number;clicks:number;spend:number;conversions:number;revenue:number;currency:string;createdAt:string;}
export interface AdsSnapshot{adAccounts:AdAccount[];paidCampaigns:PaidCampaign[];adGroups:AdGroup[];adCreatives:AdCreative[];paidAds:PaidAd[];adMetrics:AdMetric[];}

export const emptyAds=():AdsSnapshot=>({adAccounts:[],paidCampaigns:[],adGroups:[],adCreatives:[],paidAds:[],adMetrics:[]});
export class AdsManager{
 constructor(private readonly store:BusinessStore){}
 snapshot():AdsSnapshot{const s=this.store.snapshot() as BusinessSnapshot&Partial<AdsSnapshot>;return {...emptyAds(),...s};}
 private mutate(fn:(s:BusinessSnapshot&Partial<AdsSnapshot>)=>void){return this.store.mutate(fn as (s:BusinessSnapshot)=>void) as BusinessSnapshot&AdsSnapshot;}
 addAccount(input:Omit<AdAccount,"id"|"createdAt">){const s=this.snapshot();const existing=s.adAccounts.find(a=>a.platform===input.platform&&a.accountId===input.accountId);if(existing)return existing;const a={...input,id:randomUUID(),createdAt:new Date().toISOString()};this.mutate(s=>{s.adAccounts??=[];s.adAccounts.push(a)});return a;}
 createCampaign(input:Omit<PaidCampaign,"id"|"createdAt"|"updatedAt">){if(!this.snapshot().adAccounts.some(a=>a.id===input.accountId))throw new Error("ad_account_not_found");const c={...input,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};this.mutate(s=>{s.paidCampaigns??=[];s.paidCampaigns.push(c)});return c;}
 createAdGroup(input:Omit<AdGroup,"id"|"createdAt"|"updatedAt">){if(!this.snapshot().paidCampaigns.some(c=>c.id===input.campaignId))throw new Error("paid_campaign_not_found");const g={...input,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};this.mutate(s=>{s.adGroups??=[];s.adGroups.push(g)});return g;}
 createCreative(input:Omit<AdCreative,"id"|"createdAt"|"updatedAt">){const c={...input,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};this.mutate(s=>{s.adCreatives??=[];s.adCreatives.push(c)});return c;}
 createAd(input:Omit<PaidAd,"id"|"createdAt"|"updatedAt">){const s=this.snapshot();if(!s.adGroups.some(g=>g.id===input.adGroupId))throw new Error("ad_group_not_found");if(!s.adCreatives.some(c=>c.id===input.creativeId))throw new Error("creative_not_found");const a={...input,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};this.mutate(s=>{s.paidAds??=[];s.paidAds.push(a)});return a;}
 recordMetric(input:Omit<AdMetric,"id"|"createdAt">){const m={...input,id:randomUUID(),createdAt:new Date().toISOString()};this.mutate(s=>{s.adMetrics??=[];const i=s.adMetrics.findIndex(x=>x.platform===m.platform&&x.campaignId===m.campaignId&&x.date===m.date);if(i>=0)s.adMetrics[i]=m;else s.adMetrics.push(m)});return m;}
 dashboard(){const s=this.snapshot();const spend=s.adMetrics.reduce((n,m)=>n+m.spend,0),revenue=s.adMetrics.reduce((n,m)=>n+m.revenue,0),clicks=s.adMetrics.reduce((n,m)=>n+m.clicks,0),impressions=s.adMetrics.reduce((n,m)=>n+m.impressions,0),conversions=s.adMetrics.reduce((n,m)=>n+m.conversions,0);return {accounts:s.adAccounts.length,campaigns:s.paidCampaigns.length,activeCampaigns:s.paidCampaigns.filter(c=>c.status==="active").length,adGroups:s.adGroups.length,ads:s.paidAds.length,impressions,clicks,conversions,spend,revenue,roas:spend?revenue/spend:0,ctr:impressions?clicks/impressions:0,cpa:conversions?spend/conversions:0};}
}