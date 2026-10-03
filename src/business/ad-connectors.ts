import {localSecret} from "../security/local-secret-vault.js";
import type {AdPlatform,AdAccount,PaidCampaign,AdGroup,AdCreative,PaidAd,AdMetric} from "./ads.js";
export interface AdsConnector{platform:AdPlatform;createCampaign(account:AdAccount,campaign:PaidCampaign):Promise<any>;updateCampaign(account:AdAccount,campaign:PaidCampaign):Promise<any>;pauseCampaign(account:AdAccount,campaign:PaidCampaign):Promise<any>;createAdGroup(account:AdAccount,group:AdGroup):Promise<any>;createAd(account:AdAccount,ad:PaidAd,creative:AdCreative):Promise<any>;insights(account:AdAccount,campaign?:PaidCampaign):Promise<AdMetric[]>;}
async function req(url:string,init:RequestInit={}){const r=await fetch(url,init);const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={raw:t}}if(!r.ok)throw new Error(`ads_http_${r.status}`);const headers=Object.fromEntries(r.headers.entries());if(Array.isArray(d)){(d as any)._headers=headers;return d;}return {...d,_headers:headers};}
export class ConfiguredAdsConnector implements AdsConnector{
 constructor(public readonly platform:AdPlatform,private readonly base:string,private readonly token:string,private readonly paths:Record<string,string>,private readonly extraHeaders:Record<string,string>={}){}
 private async call(name:string,body?:unknown,method="POST"){const path=this.paths[name];if(!path)throw new Error(`ads_endpoint_not_configured:${this.platform}:${name}`);return req(this.base.replace(/\/$/,"")+path,{method,headers:{"content-type":"application/json",authorization:`Bearer ${this.token}`,...this.extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});}
 createCampaign(a:AdAccount,c:PaidCampaign){return this.call("campaignCreate",{accountId:a.accountId,campaign:{name:c.name,objective:c.objective,status:c.status,dailyBudget:c.dailyBudget,totalBudget:c.totalBudget,currency:c.currency,startAt:c.startAt,endAt:c.endAt}});}
 updateCampaign(a:AdAccount,c:PaidCampaign){return this.call("campaignUpdate",{accountId:a.accountId,campaignId:c.externalId,campaign:{name:c.name,status:c.status,dailyBudget:c.dailyBudget,totalBudget:c.totalBudget}});}
 pauseCampaign(a:AdAccount,c:PaidCampaign){return this.call("campaignPause",{accountId:a.accountId,campaignId:c.externalId});}
 createAdGroup(a:AdAccount,g:AdGroup){return this.call("adGroupCreate",{accountId:a.accountId,campaignId:g.campaignId,adGroup:{name:g.name,status:g.status,targeting:g.targeting,dailyBudget:g.dailyBudget}});}
 createAd(a:AdAccount,ad:PaidAd,c:AdCreative){return this.call("adCreate",{accountId:a.accountId,adGroupId:ad.adGroupId,ad:{name:ad.name,status:ad.status},creative:c});}
 async insights(a:AdAccount,c?:PaidCampaign){const d=await this.call("insights",{accountId:a.accountId,campaignId:c?.externalId},process.env[`LAYANX_${this.platform.toUpperCase()}_ADS_INSIGHTS_METHOD`]??"POST");return Array.isArray(d)?d:(d.metrics??[]);}
}
export class NativeAdsConnector implements AdsConnector{
 constructor(public readonly platform:AdPlatform,private readonly token:string,private readonly base:string){}
 private async call(path:string,body?:unknown,method="POST"){return req(this.base.replace(/\/$/,"")+path,{method,headers:{"content-type":"application/json",authorization:`Bearer ${this.token}`},body:body===undefined?undefined:JSON.stringify(body)});}
 createCampaign(a:AdAccount,c:PaidCampaign){return this.call("/campaigns",{accountId:a.accountId,campaign:{name:c.name,objective:c.objective,status:c.status,dailyBudget:c.dailyBudget,totalBudget:c.totalBudget,currency:c.currency,startAt:c.startAt,endAt:c.endAt}});}
 updateCampaign(a:AdAccount,c:PaidCampaign){return this.call("/campaigns/"+encodeURIComponent(String(c.externalId)),{accountId:a.accountId,campaign:{name:c.name,status:c.status,dailyBudget:c.dailyBudget,totalBudget:c.totalBudget}},"PATCH");}
 pauseCampaign(a:AdAccount,c:PaidCampaign){return this.call("/campaigns/"+encodeURIComponent(String(c.externalId)),{accountId:a.accountId,status:"PAUSED"},"PATCH");}
 createAdGroup(a:AdAccount,g:AdGroup){return this.call("/ad-groups",{accountId:a.accountId,campaignId:g.campaignId,adGroup:{name:g.name,status:g.status,targeting:g.targeting,dailyBudget:g.dailyBudget}});}
 createAd(a:AdAccount,ad:PaidAd,c:AdCreative){return this.call("/ads",{accountId:a.accountId,adGroupId:ad.adGroupId,ad:{name:ad.name,status:ad.status},creative:c});}
 async insights(a:AdAccount,c?:PaidCampaign){const d=await this.call("/reports",{accountId:a.accountId,campaignId:c?.externalId});return Array.isArray(d)?d:(d.metrics??[]);}
}

export function configuredAdsConnector(platform:AdPlatform){const p=platform.toUpperCase();const base=process.env[`LAYANX_${p}_ADS_BASE_URL`],token=localSecret(`${platform}.ads.token`,process.env[`LAYANX_${p}_ADS_TOKEN`]);if(!base||!token)throw new Error(`LAYANX_${p}_ADS credentials are required`);const prefix=process.env[`LAYANX_${p}_ADS_PATH_PREFIX`]??"";const keys=["campaignCreate","campaignUpdate","campaignPause","adGroupCreate","adCreate","insights"];
const paths=Object.fromEntries(keys.map(k=>{const envKey=`LAYANX_${p}_ADS_${k.replace(/([A-Z])/g,"_$1").toUpperCase()}_PATH`;return [k,process.env[envKey]??`${prefix}/${k}`]}));
let extraHeaders:Record<string,string>={};try{const raw=localSecret(`${platform}.ads.headers`,process.env[`LAYANX_${p}_ADS_HEADERS_JSON`]);if(raw)extraHeaders=JSON.parse(raw);}catch{throw new Error(`LAYANX_${p}_ADS_HEADERS_JSON must be valid JSON`);}
return new ConfiguredAdsConnector(platform,base,token,paths,extraHeaders);}

