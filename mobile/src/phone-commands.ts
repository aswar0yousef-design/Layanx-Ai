/**
 * What the phone does by itself, without the computer: opening apps, starting a WhatsApp message, and remembering notes.
 * A WhatsApp message is only prepared. Pressing send stays with the owner, and Android gives no ordinary app a way around that.
 */
export type PhoneAction={kind:"open-app";label:string;packages:string[]}|{kind:"whatsapp";phone?:string;text?:string}|{kind:"remember";note:string}|{kind:"recall";topic:string}|{kind:"forget";topic:string};
export type MemoryNote={at:string;text:string};
export interface PhoneBridge{openApp(packages:string[]):Promise<boolean>;openWhatsApp(phone:string|null,text:string|null):Promise<boolean>;memoryLoad():Promise<string|null>;memorySave(json:string):Promise<boolean>}

const APPS:Array<{label:string;names:string[];packages:string[]}>=[
  {label:"WhatsApp",names:["واتساب","واتس اب","الواتس","whatsapp"],packages:["com.whatsapp","com.whatsapp.w4b"]},
  {label:"YouTube",names:["يوتيوب","اليوتيوب","youtube"],packages:["com.google.android.youtube"]},
  {label:"Chrome",names:["كروم","chrome"],packages:["com.android.chrome","com.sec.android.app.sbrowser"]},
  {label:"الكاميرا",names:["الكاميرا","كاميرا","camera"],packages:["com.sec.android.app.camera","com.google.android.GoogleCamera"]},
  {label:"الإعدادات",names:["الاعدادات","اعدادات","settings"],packages:["com.android.settings"]},
  {label:"الخرائط",names:["الخرائط","خرائط","maps"],packages:["com.google.android.apps.maps"]},
  {label:"Instagram",names:["انستقرام","انستغرام","instagram"],packages:["com.instagram.android"]},
  {label:"Facebook",names:["فيسبوك","الفيس","facebook"],packages:["com.facebook.katana"]},
  {label:"Telegram",names:["تيليجرام","تلجرام","telegram"],packages:["org.telegram.messenger"]},
  {label:"Gmail",names:["جيميل","الايميل","البريد","gmail"],packages:["com.google.android.gm"]},
  {label:"MetaTrader 5",names:["ميتاتريدر","ام تي 5","mt5","metatrader"],packages:["net.metaquotes.metatrader5"]},
  {label:"Binance",names:["بينانس","binance"],packages:["com.binance.dev"]},
  {label:"التقويم",names:["التقويم","تقويم","calendar"],packages:["com.samsung.android.calendar","com.google.android.calendar"]},
  {label:"الاستوديو",names:["الاستوديو","المعرض","gallery"],packages:["com.sec.android.gallery3d","com.google.android.apps.photos"]}
];
const DIGITS:Record<string,string>={"٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9","۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9"};
const plain=(text:string)=>text.trim().toLowerCase().replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/[٠-٩۰-۹]/g,digit=>DIGITS[digit]!).replace(/\s+/g," ");
/** A local Saudi number becomes international; WhatsApp links need that form. */
export function internationalNumber(raw:string):string|undefined{
  let digits=plain(raw).replace(/[\s\-()]/g,"").replace(/^\+/,"").replace(/^00/,"");
  if(!/^\d+$/.test(digits))return undefined;
  if(/^05\d{8}$/.test(digits))digits="966"+digits.slice(1);
  else if(/^5\d{8}$/.test(digits))digits="966"+digits;
  return digits.length>=10&&digits.length<=15?digits:undefined;
}
const NUMBER=/(?:\+|00)?[\d٠-٩۰-۹][\d٠-٩۰-۹\s\-]{7,16}[\d٠-٩۰-۹]/;
export function parsePhoneAction(input:string):PhoneAction|null{
  const original=input.trim(),text=plain(original);
  let match=/^(?:تذكر|احفظ(?: في ذاكرتك)?|remember)(?: [اأ]ن| that)?[:\s]+(.+)$/iu.exec(original);
  if(match&&!/^(?:ماذا|هل)/.test(match[1]!))return{kind:"remember",note:match[1]!.trim()};
  match=/^(?:ماذا تذكر عن|ماذا تعرف عن|ذكرني ب|what do you remember about)\s*(.+?)[؟?]?$/u.exec(text);
  if(match)return{kind:"recall",topic:match[1]!.trim()};
  match=/^(?:انس|احذف من الذاكرة|forget)\s+(.+)$/u.exec(text);
  if(match)return{kind:"forget",topic:match[1]!.trim()};
  if(/^(?:ارسل|ابعث|راسل|send)(?:\s|$)/.test(text)&&/(?:واتس|whatsapp)/.test(text)){
    const found=NUMBER.exec(original),phone=found?internationalNumber(found[0]):undefined;
    const body=/(?:نص|يقول|saying|text)[:\s]+(.+)$/iu.exec(original)?.[1]?.trim()??/[:：]\s*(.+)$/u.exec(original)?.[1]?.trim();
    return{kind:"whatsapp",...(phone?{phone}:{}),...(body?{text:body}:{})};
  }
  match=/^(?:افتح|شغل|open|launch|start)\s+(?:تطبيق\s+|app\s+)?(.+?)[.!؟?]?$/u.exec(text);
  if(!match)return null;
  const app=APPS.find(item=>item.names.some(name=>match![1]===plain(name)));
  return app?{kind:"open-app",label:app.label,packages:app.packages}:null;
}
const MAX_NOTES=300;
const load=async(bridge:PhoneBridge):Promise<MemoryNote[]>=>{
  const raw=await bridge.memoryLoad();
  try{const notes=JSON.parse(raw??"[]");return Array.isArray(notes)?notes.filter(note=>typeof note?.text==="string"):[];}catch{return[];}
};
const about=(note:MemoryNote,topic:string)=>plain(topic).split(" ").filter(word=>word.length>1).every(word=>plain(note.text).includes(word));
/** Carries out a command. Null means it is not for the phone and should go to the computer as before. */
export async function runPhoneCommand(input:string,bridge:PhoneBridge|null|undefined,now:()=>Date=()=>new Date()):Promise<string|null>{
  const action=parsePhoneAction(input);
  if(!action)return null;
  if(!bridge)return"هذا الأمر يعمل في تطبيق Android فقط.";
  switch(action.kind){
    case"open-app":return await bridge.openApp(action.packages)?`فتحت ${action.label}.`:`${action.label} غير مثبت على هذا الهاتف.`;
    case"whatsapp":return await bridge.openWhatsApp(action.phone??null,action.text??null)?"فتحت واتساب بالرسالة. اضغط إرسال بنفسك.":"واتساب غير مثبت على هذا الهاتف.";
    case"remember":{
      const notes=await load(bridge);
      notes.push({at:now().toISOString(),text:action.note});
      await bridge.memorySave(JSON.stringify(notes.slice(-MAX_NOTES)));
      return"حفظت هذا على هاتفك.";
    }
    case"recall":{
      const found=(await load(bridge)).filter(note=>about(note,action.topic));
      return found.length?found.slice(-5).map(note=>"• "+note.text).join("\n"):"لا أجد شيئا محفوظا عن هذا على هاتفك.";
    }
    case"forget":{
      const notes=await load(bridge),kept=notes.filter(note=>!about(note,action.topic));
      await bridge.memorySave(JSON.stringify(kept));
      return notes.length===kept.length?"لا أجد شيئا محفوظا عن هذا.":`حذفت ${notes.length-kept.length} من الذاكرة.`;
    }
  }
}
