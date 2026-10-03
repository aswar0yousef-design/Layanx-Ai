import assert from "node:assert/strict";import {mkdtempSync,rmSync} from "node:fs";import {join} from "node:path";import {tmpdir} from "node:os";import {BusinessStore} from "../src/business/store.js";import {AdsManager} from "../src/business/ads.js";
const dir=mkdtempSync(join(tmpdir(),"layanx-ads-"));process.env.LAYANX_BUSINESS_STORAGE_PATH=join(dir,"business.json");const a=new AdsManager(new BusinessStore());
const account=a.addAccount({platform:"meta",name:"Meta Test",accountId:"act_test",currency:"OMR",enabled:true});
const campaign=a.createCampaign({accountId:account.id,name:"Launch",objective:"CONVERSIONS",status:"draft",dailyBudget:10,currency:"OMR"});
const group=a.createAdGroup({campaignId:campaign.id,name:"Audience",status:"draft",targeting:{countries:["OM"],ageMin:18}});
const creative=a.createCreative({name:"Creative",headline:"Test",body:"Body",destinationUrl:"https://example.com",mediaIds:[],metadata:{}});
const ad=a.createAd({adGroupId:group.id,creativeId:creative.id,name:"Ad",status:"draft"});
a.recordMetric({platform:"meta",accountId:account.id,campaignId:campaign.id,date:"2026-10-03",impressions:1000,clicks:50,spend:10,conversions:2,revenue:40,currency:"OMR"});
const d=a.dashboard();assert.equal(d.campaigns,1);assert.equal(d.ads,1);assert.equal(d.roas,4);assert.equal(d.ctr,.05);const r=new AdsManager(new BusinessStore());assert.equal(r.snapshot().paidCampaigns.length,1);assert.equal(r.snapshot().paidAds.length,1);rmSync(dir,{recursive:true,force:true});console.log("ads manager integration: ok");