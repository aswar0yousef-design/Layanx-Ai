/**
 * "Open Chrome", «افتح واتساب», «شغّل الحاسبة», "open youtube.com": what to open on this computer.
 * Shared by the desktop.app.open tool (what it runs), the planner (an "open X" request is planned without
 * the model) and the voice assistant (it does not ask the model what "open X" means).
 *
 * Nothing here runs a command line: a known program is one of a fixed list the Windows helper maps to its
 * own command; anything else is looked up by name among the Start menu's installed apps; a web page must
 * be an http(s) address.
 */
export type KnownApp="chrome"|"msedge"|"firefox"|"explorer"|"notepad"|"calc"|"settings"|"paint"|"taskmgr";
export const KNOWN_APPS:Record<KnownApp,{label:string;names:string[];browser?:boolean}>={
  chrome:{label:"Google Chrome",browser:true,names:["chrome","google chrome","كروم","جوجل كروم","قوقل كروم","غوغل كروم","متصفح كروم","متصفح جوجل كروم"]},
  msedge:{label:"Microsoft Edge",browser:true,names:["edge","microsoft edge","ms edge","ايدج","ادج","مايكروسوفت ايدج","متصفح ايدج"]},
  firefox:{label:"Firefox",browser:true,names:["firefox","فايرفوكس","فاير فوكس","متصفح فايرفوكس"]},
  explorer:{label:"File Explorer",names:["explorer","file explorer","files","مستكشف الملفات","مستكشف","الملفات","ملفاتي"]},
  notepad:{label:"Notepad",names:["notepad","المفكره","مفكره","النوتباد","نوتباد"]},
  calc:{label:"Calculator",names:["calculator","calc","الحاسبه","حاسبه","الاله الحاسبه"]},
  settings:{label:"Settings",names:["settings","windows settings","الاعدادات","اعدادات","اعدادات ويندوز"]},
  paint:{label:"Paint",names:["paint","mspaint","الرسام","رسام"]},
  taskmgr:{label:"Task Manager",names:["task manager","taskmgr","مدير المهام","اداره المهام"]}
};
/** Arabic (and common) names of programs found by their Start menu name. */
const START_MENU_NAMES:Record<string,string>={
  "واتساب":"WhatsApp","واتس اب":"WhatsApp","الواتساب":"WhatsApp","whatsapp":"WhatsApp",
  "وورد":"Word","ورد":"Word","word":"Word","اكسل":"Excel","excel":"Excel","باوربوينت":"PowerPoint","بوربوينت":"PowerPoint","powerpoint":"PowerPoint",
  "اوتلوك":"Outlook","outlook":"Outlook","تيمز":"Teams","teams":"Teams","تيليجرام":"Telegram","تلجرام":"Telegram","تليجرام":"Telegram","telegram":"Telegram",
  "سبوتيفاي":"Spotify","spotify":"Spotify","ديسكورد":"Discord","discord":"Discord","زووم":"Zoom","zoom":"Zoom","سكايب":"Skype","skype":"Skype",
  "ميتاتريدر":"MetaTrader","ميتا تريدر":"MetaTrader","ميتاتريدر 5":"MetaTrader 5","mt5":"MetaTrader 5","metatrader":"MetaTrader","metatrader 5":"MetaTrader 5",
  "في اس كود":"Visual Studio Code","فيجوال ستوديو كود":"Visual Studio Code","vs code":"Visual Studio Code","vscode":"Visual Studio Code","visual studio code":"Visual Studio Code",
  "فوتوشوب":"Photoshop","photoshop":"Photoshop","ستيم":"Steam","steam":"Steam","فيديو":"Media Player","مشغل الوسائط":"Media Player","الصور":"Photos","photos":"Photos",
  "الكاميرا":"Camera","camera":"Camera","المتجر":"Microsoft Store","متجر مايكروسوفت":"Microsoft Store","microsoft store":"Microsoft Store",
  "ollama":"Ollama","اولاما":"Ollama","obs":"OBS Studio","او بي اس":"OBS Studio","anydesk":"AnyDesk","اني ديسك":"AnyDesk"
};
const norm=(s:string)=>s.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")
  .replace(/[«»"'“”.,،!؟?:;()]/g," ").replace(/\s+/g," ").trim();
const KNOWN_BY_NAME=new Map<string,KnownApp>(Object.entries(KNOWN_APPS).flatMap(([k,v])=>[...v.names,v.label].map(n=>[norm(n),k as KnownApp] as [string,KnownApp])));
const START_BY_NAME=new Map(Object.entries(START_MENU_NAMES).map(([k,v])=>[norm(k),v]));
const APP_NAME=/^[\p{L}\p{N} .+&_-]{1,60}$/u;

export type OpenTarget={kind:"known";app:KnownApp;label:string}|{kind:"start";name:string;label:string}|{kind:"url";url:string;browser?:KnownApp;label:string};

/** A web address the owner said ("youtube.com", "https://…"), as an https URL; null when it is not one. */
export function webAddress(text:string):string|null{
  const t=text.trim().replace(/[.،,]+$/,"");
  const withScheme=/^https?:\/\//i.test(t)?t:/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(t)?"https://"+t:null;
  if(!withScheme||/\s|["'<>`]/.test(withScheme)||withScheme.length>2048)return null;
  try{const u=new URL(withScheme);return u.protocol==="https:"||u.protocol==="http:"?u.toString():null;}catch{return null;}
}
/** What desktop.app.open will open for a payload {app?, url?} (a known program, a Start-menu name, or a web page). */
export function resolveOpenTarget(payload:{app?:unknown;url?:unknown}):OpenTarget{
  const appText=typeof payload.app==="string"?payload.app.trim():"";
  const urlText=typeof payload.url==="string"?payload.url.trim():"";
  const known=appText?KNOWN_BY_NAME.get(norm(appText)):undefined;
  if(urlText){
    const url=webAddress(urlText);if(!url)throw new Error("url must be an http(s) web address.");
    if(appText&&!(known&&KNOWN_APPS[known].browser))throw new Error("A web page opens in a browser: Chrome, Edge or Firefox.");
    return{kind:"url",url,...(known?{browser:known}:{}),label:url};
  }
  if(!appText)throw new Error("Say which program to open (payload.app) or which web page (payload.url).");
  if(known)return{kind:"known",app:known,label:KNOWN_APPS[known].label};
  const url=webAddress(appText);if(url)return{kind:"url",url,label:url};
  const mapped=START_BY_NAME.get(norm(appText));
  const name=mapped??appText.replace(/^(?:برنامج|تطبيق|app|program)\s+/i,"").trim();
  if(!APP_NAME.test(name))throw new Error("The program name may contain letters, numbers, spaces and . + & _ - only.");
  return{kind:"start",name,label:name};
}

const OPEN_VERB=/^(?:(?:يا\s+)?(?:ليان|جارفيس)[\s،,]+)?(?:لو سمحت\s+)?(?:افتح|إفتح|أفتح|شغل|شغّل|افتحلي|افتح لي|شغل لي|open|launch|start|run)\s+(?:لي\s+)?(?:برنامج|تطبيق|موقع|the\s+app|the\s+program|app|program)?\s*(.+)$/iu;
/**
 * A short "open X" request whose X is certainly something to open: a known program, a Start-menu
 * name LayanX knows, or a web address. Anything else ("open the report file") goes to the planner.
 */
export function openRequest(text:string):{app?:string;url?:string;label:string}|null{
  const t=text.trim();
  if(!t||t.length>90||t.includes("\n"))return null;
  const m=t.match(OPEN_VERB);if(!m)return null;
  let target=m[1]!.trim().replace(/[.،,!؟?]+$/,"").replace(/^the\s+/i,"");
  // «افتح المتصفح» / "open the browser": the default browser, on a search page.
  if(/^(?:المتصفح|متصفح|browser|web browser|الانترنت|الإنترنت)$/i.test(target))return{url:"https://www.google.com/",label:"https://www.google.com/"};
  // «متصفح جوجل كروم» / "the Chrome browser" is the browser itself.
  const bare=target.replace(/^(?:متصفح|browser)\s+/i,"").replace(/\s+(?:browser|متصفح)$/i,"");
  if(bare!==target&&KNOWN_BY_NAME.has(norm(bare)))target=bare;
  const known=KNOWN_BY_NAME.get(norm(target));
  if(known)return{app:target,label:KNOWN_APPS[known].label};
  const url=webAddress(target);if(url)return{url,label:url};
  const onBrowser=target.match(/^(.+?)\s+(?:في|على|ب|in|on|with)\s+(.+)$/i);
  if(onBrowser){const b=KNOWN_BY_NAME.get(norm(onBrowser[2]!));const u=webAddress(onBrowser[1]!);if(b&&KNOWN_APPS[b].browser&&u)return{app:onBrowser[2]!.trim(),url:u,label:u};}
  const mapped=START_BY_NAME.get(norm(target));
  if(mapped)return{app:mapped,label:mapped};
  return null;
}
