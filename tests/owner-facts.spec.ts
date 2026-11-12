import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {OwnerFacts,factCommand,factReply,factsForPrompt,looksSecret} from "../src/memory/owner-facts.js";

assert.deepEqual(factCommand("تذكر أن شركة الشحن المفضلة عندي هي سمسا"),{kind:"remember",fact:"شركة الشحن المفضلة عندي هي سمسا"});
assert.deepEqual(factCommand("remember that I never post on Fridays."),{kind:"remember",fact:"I never post on Fridays"});
assert.deepEqual(factCommand("انسَ أن شركة الشحن سمسا"),{kind:"forget",what:"شركة الشحن سمسا"});
assert.deepEqual(factCommand("ماذا تتذكر عني؟"),{kind:"list"});
assert.equal(factCommand("هل تتذكر متى بدأنا؟"),null,"a question about remembering is not a command");
assert.equal(factCommand("كم طلب اليوم في متجري"),null);
for(const s of ["كلمة السر لحسابي هي Abc12345","رقم بطاقتي 4111 1111 1111 1111","my api key is sk-abcdefghijklmnop","رمز التحقق 552211"])assert.ok(looksSecret(s),s);
assert.ok(!looksSecret("رقم جوال المحل 0501234567"),"a 10-digit phone is not a card");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owner-facts-"));
{
  const facts=new OwnerFacts(path.join(dir,"owner-facts.json"));
  assert.match(factReply(facts,factCommand("تذكر أن شركة الشحن المفضلة عندي هي سمسا")!,true),/حفظتُ/);
  factReply(facts,factCommand("تذكر أن متجري اسمه اللواء الأخضر")!,true);
  factReply(facts,factCommand("تذكر أني لا أنشر في وسائل التواصل يوم الجمعة")!,true);
  assert.equal(facts.list().at(-1)!.text,"أنا لا أنشر في وسائل التواصل يوم الجمعة","the first person is kept, not cut");
  assert.match(factReply(facts,factCommand("تذكر أن كلمة السر لحسابي هي Abc12345")!,true),/لا أحفظ كلمات السر/);
  // A newer fact about the same thing replaces the older one.
  assert.match(factReply(facts,factCommand("تذكر أن شركة الشحن المفضلة عندي هي أرامكس")!,true),/بدل ما كان: «شركة الشحن المفضلة عندي هي سمسا»/);
  assert.equal(facts.list().length,3);
}
{
  // After a restart (a new object reading the same file), the facts are there and the right one is found.
  const facts=new OwnerFacts(path.join(dir,"owner-facts.json"));
  assert.deepEqual(facts.relevant("ما شركة الشحن المفضلة عندي؟").map(f=>f.text)[0],"شركة الشحن المفضلة عندي هي أرامكس");
  assert.match(facts.relevant("ما اسم متجري؟")[0]!.text,/اللواء الأخضر/);
  assert.equal(facts.relevant("كم الساعة؟").length,0,"nothing unrelated is added");
  assert.match(factsForPrompt(facts,"هل أنشر يوم الجمعة؟"),/لا أنشر في وسائل التواصل يوم الجمعة/);
  assert.ok(!JSON.stringify(facts.list()).includes("Abc12345"),"the secret was never written");
  assert.match(factReply(facts,{kind:"list"},true),/ما طلبتَ مني تذكّره/);
  assert.match(factReply(facts,factCommand("انسَ اسم متجري")!,true),/نسيتُ: «متجري اسمه اللواء الأخضر»/);
  assert.equal(facts.list().length,2);
}
{
  // The assistant: commands answered without a model; the facts reach the answer prompt.
  const {VoiceAssistant}=await import("../src/voice/assistant.js");
  const prompts:string[]=[];
  const facts=new OwnerFacts(path.join(dir,"owner-facts.json"));
  const a=new VoiceAssistant({facts,decide:async(p:string)=>{prompts.push(p);return JSON.stringify({intent:"answer",reply:"شركة الشحن المفضلة عندك أرامكس."});},runTask:async()=>({}),snapshot:()=>({missions:[],approvals:[],schedules:0})} as any);
  assert.match((await a.turn({text:"تذكر أن لون علامتي التجارية أخضر"} as any)).reply,/حفظتُ/);assert.equal(prompts.length,0,"no model for a command");
  const r=await a.turn({text:"ما شركة الشحن المفضلة عندي؟"} as any);
  assert.match(prompts.at(-1)!,/What the owner told you to remember[\s\S]*أرامكس/);assert.match(r.reply,/أرامكس/);
}
{
  // On WhatsApp: the owner's facts are the owner's; staff can neither read nor change them.
  const {ChannelRouter}=await import("../src/channels/router.js");
  process.env.LAYANX_STORE_DIR=dir;
  const router=new ChannelRouter({modelExecution:{execute:async()=>({output:"—"})}} as any,{ownerIds:new Set(["owner"]),staffIds:new Set(["staff"])});
  const say=(text:string,senderId:string)=>router.handle({channel:"whatsapp",messageId:String(Math.random()),senderId,chatId:senderId,text,role:"unknown"});
  assert.match(await say("ماذا تتذكر عني؟","staff"),/يخصه وحده/);
  assert.match(await say("تذكر أن الموظف أحمد مدير","staff"),/يخصه وحده/);
  assert.match(await say("ماذا تتذكر عني؟","owner"),/أرامكس/);
}
console.log("owner-facts: remembered across a restart, used in answers, newer facts replace older ones, secrets refused, owner only");
process.exit(0);
