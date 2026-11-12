import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {startFakeWoo} from "./fixtures/fake-woocommerce.js";
import {startFakeGraph} from "./fixtures/fake-graph.js";

/**
 * The owner on WhatsApp/Telegram (found 2026-11-13): a finished task used to answer "تم تنفيذ الطلب بنجاح" with no numbers,
 * and an approval meant opening the panel. Now the reply is the real answer, and the owner approves the exact step by message.
 */
const woo=await startFakeWoo({key:"ck_c",secret:"cs_c"});
const graph=await startFakeGraph({token:"page_c"});
const root=fs.mkdtempSync(path.join(os.tmpdir(),"channel-owner-"));const dir=path.join(root,"s");fs.mkdirSync(dir);fs.mkdirSync(path.join(root,"p","default"),{recursive:true});
Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:path.join(root,"p"),LAYANX_STORE_DIR:dir,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_BUSINESS_STORAGE_PATH:path.join(dir,"b.json"),LAYANX_RUNTIME_STORAGE_PATH:path.join(dir,"r.json"),LAYANX_LESSONS_FILE:path.join(dir,"l.json"),LAYANX_TRUST_FILE:path.join(root,"t.json"),LAYANX_SECRET_VAULT_PATH:path.join(dir,"v"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_HUMANIZER:"off",
  LAYANX_WOOCOMMERCE_URL:woo.url,LAYANX_WOOCOMMERCE_CONSUMER_KEY:"ck_c",LAYANX_WOOCOMMERCE_CONSUMER_SECRET:"cs_c",LAYANX_WOOCOMMERCE_ALLOW_WRITES:"on",
  LAYANX_FACEBOOK_SOCIAL_TOKEN:"page_c",LAYANX_FACEBOOK_SOCIAL_BASE_URL:graph.url});
try{
  const {createRuntime}=await import("../src/runtime.js");
  const {ChannelRouter}=await import("../src/channels/router.js");
  const runtime:any=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const core=runtime.core;
  runtime.business.upsertSocialAccount({platform:"facebook",name:"الصفحة",externalId:"p1",enabled:true});
  let clock=Date.now();
  const router=new ChannelRouter(core,{ownerIds:new Set(["owner"]),staffIds:new Set(["staff"])},()=>clock);
  const say=(text:string,senderId="owner",chatId="chat-owner")=>router.handle({channel:"whatsapp",messageId:String(Math.random()),senderId,chatId,text,role:"unknown"});
  // A store question: the store's own numbers, not "done".
  const report=await say("كم طلب جاني اليوم في متجري؟");
  assert.match(report,/5 طلب، والمبيعات المدفوعة 183 SAR/,report);
  // A store change: described exactly, approved by message, read back.
  const ask=await say("خفّض سعر عسل السدر في متجري إلى 40");
  assert.match(ask,/تحتاج هذه الخطوة موافقتك/);assert.match(ask,/خفّض سعر عسل السدر في متجري إلى 40/);assert.match(ask,/«موافق»/);
  assert.equal(woo.products.find(p=>p.id===11)!.regular_price,"45","nothing changed before the approval");
  assert.match(await say("ok","staff","chat-owner"),/فقط صاحب LayanX يوافق/,"staff cannot approve");
  // The staff message took the pending approval away; ask again.
  await say("خفّض سعر عسل السدر في متجري إلى 40");
  const done=await say("موافق");
  assert.match(done,/السعر كان 45 وصار 40/,done);assert.equal(woo.products.find(p=>p.id===11)!.regular_price,"40");
  // "No" changes nothing.
  await say("خفّض سعر زيت السمسم في متجري إلى 15");
  assert.match(await say("لا"),/ألغيتُ الخطوة/);assert.equal(woo.products.find(p=>p.id===13)!.regular_price,"18");
  // An approval left too long expires.
  await say("خفّض سعر زيت السمسم في متجري إلى 15");
  clock+=16*60_000;
  assert.match(await say("موافق"),/انتهت مهلة الموافقة/);assert.equal(woo.products.find(p=>p.id===13)!.regular_price,"18");
  // A post: the approval message carries the whole text.
  await say("اكتب منشور للفيس نصه: عرض نهاية الأسبوع على البن الحرازي");
  const postAsk=await say("انشر المنشور");
  assert.match(postAsk,/سأنشر هذا النص حرفياً على facebook:\n———\nعرض نهاية الأسبوع على البن الحرازي\n———/,postAsk);
  assert.equal(graph.posts.length,0);
  assert.match(await say("موافق"),/النص مطابق/);assert.deepEqual(graph.posts.map(p=>p.message),["عرض نهاية الأسبوع على البن الحرازي"]);
  // Money is never moved from a chat.
  // Found 2026-11-13: this reached a chat model that answered "تمحول 500 إلى حساب التداول" (claiming a transfer it never made).
  for(const t of ["حوّل 500 من أرباح المتجر إلى حساب التداول","ارسل 200 دولار لأحمد","ادفع فاتورة الشحن","اسحب أرباح التداول إلى البنك"])
    assert.match(await say(t),/لن أقوم به، ولم يُنقل أي مال/,t);
  const {movesMoney}=await import("../src/autonomy/domain-coordinator.js");
  for(const t of ["transfer 300 to my trading account","pay the DHL invoice","حول 500 ريال لحسابي في بينانس"])assert.ok(movesMoney(t),t);
  for(const t of ["حول الملف إلى PDF","ارسل المنشور","send the invoice email","كم أرباح المتجر اليوم؟","ارسل رسالة لأحمد","اطبع فاتورة الطلب 1041"])assert.ok(!movesMoney(t),t);
}finally{await woo.close();await graph.close();}
console.log("channel owner tasks: real answers on WhatsApp, the exact step approved by the owner's reply, expiring, staff cannot approve");
// (exit moved to the end)
{
  // The panel and voice assistant refuse it too, before any model is asked.
  const {VoiceAssistant}=await import("../src/voice/assistant.js");
  let asked=0;
  const a=new VoiceAssistant({decide:async()=>{asked++;return"{}";},runTask:async()=>{asked++;return{};},snapshot:()=>({missions:[],approvals:[],schedules:0})} as any);
  const r=await a.turn({text:"حوّل 500 من أرباح المتجر إلى حساب التداول",allowTasks:true} as any);
  assert.match(r.reply,/لن أقوم به، ولم يُنقل أي مال/);assert.equal(asked,0,"no model and no task");
  console.log("channel owner tasks: the assistant refuses moving money without asking any model");
}
process.exit(0);
