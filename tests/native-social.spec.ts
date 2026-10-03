import assert from "node:assert/strict";
import {NativeSocialConnector} from "../src/business/native-social.js";

process.env.LAYANX_X_SOCIAL_TOKEN="test-token";
const original=globalThis.fetch;
globalThis.fetch=(async(url,init)=>{
 assert.equal(url,"https://api.x.com/2/tweets");
 assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer test-token");
 return new Response(JSON.stringify({data:{id:"123"}}),{status:201,headers:{"content-type":"application/json"}});
}) as typeof fetch;
const connector=new NativeSocialConnector("x");
const result=await connector.publish({id:"a",platform:"x",name:"demo",externalId:"u1",enabled:true,createdAt:new Date().toISOString()},{title:"Test",body:"hello",mediaUrls:[]});
assert.equal(result.externalId,"123");assert.match(result.url??"",/123$/);
globalThis.fetch=original;
console.log("native social connector: ok");
