import assert from "node:assert/strict";
import {internationalNumber,parsePhoneAction,runPhoneCommand,type PhoneBridge} from "../mobile/src/phone-commands.js";

assert.equal(internationalNumber("0501234567"),"966501234567");
assert.equal(internationalNumber("٠٥٠١٢٣٤٥٦٧"),"966501234567");
assert.equal(internationalNumber("+966 50 123 4567"),"966501234567");
assert.equal(internationalNumber("00201001234567"),"201001234567");
assert.equal(internationalNumber("123"),undefined);

assert.deepEqual(parsePhoneAction("افتح واتساب"),{kind:"open-app",label:"WhatsApp",packages:["com.whatsapp","com.whatsapp.w4b"]});
assert.equal((parsePhoneAction("شغل اليوتيوب") as any).label,"YouTube");
assert.equal((parsePhoneAction("open MT5") as any).label,"MetaTrader 5");
// Anything else goes to the computer as before.
assert.equal(parsePhoneAction("افتح المشروع وأصلح العطل"),null);
assert.equal(parsePhoneAction("ما حالة الخادم؟"),null);
assert.deepEqual(parsePhoneAction("ارسل واتساب إلى 0501234567 نص: السلام عليكم"),{kind:"whatsapp",phone:"966501234567",text:"السلام عليكم"});
assert.deepEqual(parsePhoneAction("send whatsapp to +966501234567 saying hello"),{kind:"whatsapp",phone:"966501234567",text:"hello"});
assert.deepEqual(parsePhoneAction("ارسل رسالة واتساب"),{kind:"whatsapp"});
assert.deepEqual(parsePhoneAction("تذكر أن موعد الطبيب يوم الأحد"),{kind:"remember",note:"موعد الطبيب يوم الأحد"});
assert.deepEqual(parsePhoneAction("ماذا تذكر عن الطبيب؟"),{kind:"recall",topic:"الطبيب"});

function bridge(installed:string[]=["com.whatsapp"]){
  const calls:any[]=[];let stored:string|null=null;
  const b:PhoneBridge={openApp:async p=>{calls.push(p);return p.some(x=>installed.includes(x));},openWhatsApp:async(phone,text)=>{calls.push([phone,text]);return installed.includes("com.whatsapp");},memoryLoad:async()=>stored,memorySave:async j=>{stored=j;return true;}};
  return{b,calls,set:(v:string)=>{stored=v;},get:()=>stored};
}
{
  const {b,calls}=bridge();
  assert.equal(await runPhoneCommand("افتح واتساب",b),"فتحت WhatsApp.");
  assert.match((await runPhoneCommand("افتح يوتيوب",b))!,/غير مثبت/);
  assert.match((await runPhoneCommand("ارسل واتساب إلى 0501234567 نص: مرحبا",b))!,/اضغط إرسال بنفسك/);
  assert.deepEqual(calls.at(-1),["966501234567","مرحبا"]);
  assert.equal(await runPhoneCommand("كيف حالك",b),null);
  assert.match((await runPhoneCommand("افتح واتساب",null))!,/Android فقط/);
}
{ // Memory stays on the phone, across uses, and can be removed.
  const s=bridge();
  const at=()=>new Date("2026-01-01T00:00:00Z");
  await runPhoneCommand("تذكر أن موعد الطبيب يوم الأحد",s.b,at);
  await runPhoneCommand("تذكر أن رقم الغرفة 12",s.b,at);
  assert.match((await runPhoneCommand("ماذا تذكر عن الطبيب؟",s.b))!,/موعد الطبيب/);
  assert.match((await runPhoneCommand("ماذا تذكر عن السفر؟",s.b))!,/لا أجد/);
  assert.match((await runPhoneCommand("انس الطبيب",s.b))!,/حذفت 1/);
  assert.equal(JSON.parse(s.get()!).length,1);
  s.set("not json");
  assert.match((await runPhoneCommand("ماذا تذكر عن الطبيب؟",s.b))!,/لا أجد/);
}
console.log("mobile-phone-commands: apps open by name, WhatsApp is prepared but not sent, notes stay on the phone");
