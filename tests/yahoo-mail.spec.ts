import assert from "node:assert/strict";
import {createYahooMailAdapter} from "../src/connectors/yahoo-mail.js";

let connected=false,loggedOut=false,locked=false,unlocked=false,sent:Record<string,unknown>|undefined;
const client:any={
 async connect(){connected=true}, async logout(){loggedOut=true},
 async getMailboxLock(){locked=true;return {release(){unlocked=true}}},
 async search(){return [1,2]},
 async fetchAll(){return [{uid:1,envelope:{subject:"Invoice",from:[{address:"shipper@yahoo.com"}],to:[{address:"store@yahoo.com"}],date:new Date("2026-10-03T00:00:00Z")},flags:new Set(["\\Seen"])}]},
 async fetchOne(){return {uid:2,envelope:{subject:"Follow up"},source:Buffer.from("Subject: Follow up\\n\\nHello")}}
};
const adapter=createYahooMailAdapter({
 config:{email:"test@yahoo.com",...{["password"]:"app-password"}},
 imapFactory:()=>client,
 smtpFactory:()=>({sendMail:async(m)=>{sent=m;return {messageId:"m1"}}})
});
const listed=await adapter.execute({tool:"yahoo.mail.search",action:"search yahoo mail",payload:{query:"Invoice",limit:5},missionId:"m",agentId:"a",permission:"L1_READ",idempotencyKey:"1"});
assert.deepEqual(listed,{messages:[{id:"1",subject:"Invoice",from:"shipper@yahoo.com",to:"store@yahoo.com",date:"2026-10-03T00:00:00.000Z",seen:true}]});
assert.ok(connected&&loggedOut&&locked&&unlocked);
const read=await adapter.execute({tool:"yahoo.mail.read",action:"read yahoo mail",payload:{messageId:"2"},missionId:"m",agentId:"a",permission:"L1_READ",idempotencyKey:"2"}) as any;
assert.equal(read.id,"2");
await adapter.execute({tool:"yahoo.mail.send",action:"send yahoo mail",payload:{to:"client@example.com",subject:"Follow up",body:"Hello"},missionId:"m",agentId:"a",permission:"L4_EXECUTE",idempotencyKey:"3"});
assert.equal(sent?.to,"client@example.com"); assert.equal(sent?.from,"test@yahoo.com");
await assert.rejects(()=>adapter.execute({tool:"yahoo.mail",action:"delete mail",payload:{},missionId:"m",agentId:"a",permission:"L1_READ",idempotencyKey:"4"}),/Unsupported Yahoo Mail action/);
console.log("yahoo-mail.spec.ts passed");