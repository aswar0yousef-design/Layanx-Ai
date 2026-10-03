import assert from "node:assert/strict";
import {NativeSocialConnector} from "../src/business/native-social.js";

process.env.LAYANX_PINTEREST_SOCIAL_TOKEN="pinterest-test";
process.env.LAYANX_PINTEREST_SOCIAL_BASE_URL="https://api.pinterest.com/v5";
const original=globalThis.fetch;
globalThis.fetch=(async(url,init)=>{
 assert.equal(url,"https://api.pinterest.com/v5/pins");
 const headers=init?.headers as Record<string,string>;
 assert.equal(headers.Authorization,"Bearer pinterest-test");
 const body=JSON.parse(String(init?.body));
 assert.equal(body.board_id,"board-1");
 assert.equal(body.media_source.source_type,"image_url");
 return new Response(JSON.stringify({id:"pin-123"}),{status:201});
}) as typeof fetch;
const result=await new NativeSocialConnector("pinterest").publish(
 {id:"p",platform:"pinterest",name:"Board",externalId:"board-1",enabled:true,createdAt:new Date().toISOString()},
 {title:"Test Pin",body:"Description",mediaUrls:["https://example.test/image.jpg"]}
);
assert.equal(result.externalId,"pin-123");
assert.match(result.url??"",/pin-123/);
globalThis.fetch=original;
console.log("pinterest native publishing: ok");
