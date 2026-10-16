import fs from "node:fs";
import path from "node:path";
import {writeFileAtomic} from "../platform/paths.js";
import type {ContentQuality,SocialPlatform} from "./types.js";
import {DISCLOSURE_RE,HOMOGLYPHS,META_RE,PATTERNS,fold,type TextPattern} from "./humanizer-patterns.js";

/**
 * The humanizer: makes text that LayanX writes for people (posts on every social
 * platform, website copy, app screens and store listings, video scripts, emails)
 * read like a person wrote it, in three steps that every content path shares:
 *
 *  1. cleanText   mechanical and always safe: hidden characters, odd spaces,
 *                 look-alike letters, markdown a platform will not render, chatbot
 *                 leftovers ("Sure! Here's a caption:"). Visible wording is untouched.
 *  2. scanText    five checks (burstiness, specificity, slop density, fingerprint,
 *                 voice) plus the platform's own limits, each pass / warn / fail.
 *  3. humanizeText  when the checks fail, the local model rewrites the text with
 *                 the findings, then LayanX verifies that no number, price, date,
 *                 link, @mention, #hashtag or protected passage was lost or
 *                 changed, and keeps the rewrite only if it is better.
 *
 * Protected, never rewritten: Quran (\uFD3F…\uFD3E) and other fully vowelled passages,
 * quotations, code, links, e-mail addresses, and the labels a platform or the law
 * requires (#ad, #إعلان, "paid partnership", "AI-generated"…).
 * No outside detector is called: the owner's text never leaves this PC for scoring.
 * The checks measure writing habits; they do not promise any detector's verdict.
 */
export type HumanizePlatform=SocialPlatform|"threads"|"telegram"|"whatsapp"|"bluesky"|"google_business"|"email"|"web"|"app";
export type TextKind="post"|"title"|"meta"|"cta"|"script"|"subject"|"push"|"ui"|"store_title"|"store_short"|"store_description";
export type TextFormat="text"|"markdown"|"html";
export type CheckId="burstiness"|"specificity"|"slop"|"fingerprint"|"voice"|"platform";
export type CheckStatus="pass"|"warn"|"fail";
export interface HumanizeCheck{id:CheckId;label:string;status:CheckStatus;score:number;value:string;detail:string}
export interface HumanizeFinding{check:CheckId;kind:string;text:string;count:number;fix?:string}
export interface HumanizeReport{
  verdict:"pass"|"review"|"fail";
  /** 0-100, higher reads more like a person. */
  humanScore:number;
  lang:"ar"|"en"|"mixed";
  platform:HumanizePlatform;
  kind:TextKind;
  checks:HumanizeCheck[];
  findings:HumanizeFinding[];
  stats:{words:number;sentences:number;length:number;unit:LengthUnit;limit?:number;advice?:number;hashtags:number};
}
export interface VoiceProfile{samples:string[];dialect?:string;tone?:string;person?:"i"|"we"|"";avoid:string[];prefer:string[];updatedAt?:string}
export interface HumanizeOptions{platform?:HumanizePlatform;kind?:TextKind;lang?:"ar"|"en";format?:TextFormat;keep?:string[];voice?:VoiceProfile|null;maxAttempts?:number}
export interface CleanChange{kind:string;count:number}
export interface FactLoss{kind:string;value:string}
export type GenerateText=(prompt:string,maxOutputTokens:number)=>Promise<string>;
export interface HumanizeResult{text:string;original:string;rewritten:boolean;cleaned:CleanChange[];before:HumanizeReport;after:HumanizeReport;attempts:number;lost:FactLoss[];note?:string}

// ---------------------------------------------------------------- platforms
type LengthUnit="chars"|"x"|"bytes"|"graphemes";
interface PlatformRule{label:string;unit:LengthUnit;max?:number;advice?:number;hashtagsMax?:number;hashtagsAdvice?:number;markdown:boolean;mediaCaption?:number;note?:string}
/** Limits as the platforms publish them (checked 2026-10). `max` is enforced by the platform, `advice` is what reads well. */
export const PLATFORM_RULES:Record<HumanizePlatform,PlatformRule>={
  generic:{label:"Generic",unit:"chars",markdown:true},
  instagram:{label:"Instagram",unit:"chars",max:2200,hashtagsMax:5,markdown:false,note:"Instagram allows at most 5 hashtags per post."},
  facebook:{label:"Facebook",unit:"chars",max:63206,markdown:false},
  tiktok:{label:"TikTok",unit:"chars",max:2200,hashtagsAdvice:5,markdown:false},
  youtube:{label:"YouTube",unit:"bytes",max:5000,hashtagsMax:60,hashtagsAdvice:3,markdown:false,note:"Over 60 hashtags and YouTube ignores all of them; the first 3 show above the title."},
  x:{label:"X",unit:"x",max:280,hashtagsAdvice:2,markdown:false,note:"Links count as 23; most emoji and characters outside Latin/Arabic count as 2."},
  linkedin:{label:"LinkedIn",unit:"chars",max:3000,hashtagsAdvice:5,markdown:false},
  snapchat:{label:"Snapchat",unit:"chars",max:500,markdown:false},
  pinterest:{label:"Pinterest",unit:"chars",max:800,hashtagsAdvice:5,markdown:false},
  threads:{label:"Threads",unit:"chars",max:500,hashtagsAdvice:1,markdown:false,note:"Threads turns only one tag per post into a topic."},
  telegram:{label:"Telegram",unit:"chars",max:4096,mediaCaption:1024,markdown:false},
  whatsapp:{label:"WhatsApp",unit:"chars",max:4096,markdown:false},
  bluesky:{label:"Bluesky",unit:"graphemes",max:300,markdown:false},
  google_business:{label:"Google Business Profile",unit:"chars",max:1500,markdown:false},
  email:{label:"E-mail",unit:"chars",markdown:false},
  web:{label:"Website",unit:"chars",markdown:true},
  app:{label:"App",unit:"chars",markdown:false}
};
const KIND_RULES:Partial<Record<TextKind,Partial<PlatformRule>>>={
  title:{advice:60},meta:{advice:160},cta:{advice:30},subject:{advice:60},push:{advice:110},
  store_title:{max:30},store_short:{max:80},store_description:{max:4000}
};
export const TEXT_KINDS:TextKind[]=["post","title","meta","cta","script","subject","push","ui","store_title","store_short","store_description"];
/** The rule for one piece of text: a post follows the platform; a title, button or store field has its own limit and takes no hashtags. */
export function platformRule(platform:HumanizePlatform="generic",kind:TextKind="post"):PlatformRule{
  const base=PLATFORM_RULES[platform]??PLATFORM_RULES.generic;
  if(kind==="post")return base;
  if(kind==="title"&&(platform==="youtube"||platform==="pinterest"))return{label:base.label,unit:"chars",max:100,hashtagsAdvice:0,markdown:false};
  const extra=KIND_RULES[kind]??{};
  return{label:base.label,unit:"chars",markdown:kind==="ui"?false:base.markdown&&kind!=="script",hashtagsAdvice:0,...(extra.max!==undefined?{max:extra.max}:{}),...(extra.advice!==undefined?{advice:extra.advice}:{})};
}

// ---------------------------------------------------------------- text basics
const EMOJI=/\p{Extended_Pictographic}/u;
const graphemes=new Intl.Segmenter(undefined,{granularity:"grapheme"});
const WORD=/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;
const words=(text:string)=>text.match(WORD)??[];
const HASHTAG=/(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;
const URL_RE=/https?:\/\/[^\s<>"'«»]+|www\.[^\s<>"'«»]+/gi;
const clamp=(n:number,lo=0,hi=100)=>Math.max(lo,Math.min(hi,n));
const round=(n:number,d=2)=>Math.round(n*10**d)/10**d;

function detectLang(text:string):"ar"|"en"|"mixed"{
  const ar=(text.match(/[\u0600-ۿݐ-ݿ]/g)??[]).length,la=(text.match(/[A-Za-z]/g)??[]).length;
  if(ar+la===0)return"en";
  return ar/(ar+la)>0.7?"ar":la/(ar+la)>0.7?"en":"mixed";
}
/** The sentences a reader reads: no links, no tag lists. A line break ends a sentence (social posts are written in lines). */
function proseOf(text:string):string{
  return text.replace(URL_RE," ").replace(/(?<![\p{L}\p{N}_])[#@][\p{L}\p{N}_.]+/gu," ").split("\n").filter(l=>words(l).length>0).join("\n");
}
function sentencesOf(prose:string):string[]{
  return prose.split(/(?<=[.!?؟。…])\s+|\n+/u).map(s=>s.trim()).filter(s=>words(s).length>0);
}
export function measureLength(text:string,unit:LengthUnit):number{
  if(unit==="bytes")return Buffer.byteLength(text,"utf8");
  if(unit==="chars")return[...text].length;
  if(unit==="graphemes")return[...graphemes.segment(text)].length;
  let n=0;
  for(const {segment} of graphemes.segment(text.replace(/https?:\/\/\S+/gi,"x".repeat(23)))){
    if(EMOJI.test(segment)){n+=2;continue;}
    for(const ch of segment){const c=ch.codePointAt(0)!;n+=c<=4351||(c>=8192&&c<=8205)||(c>=8208&&c<=8223)||(c>=8242&&c<=8247)?1:2;}
  }
  return n;
}
function htmlToText(html:string):string{
  return html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi," ").replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article|tr)>/gi,"\n").replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/[ \t]+/g," ").replace(/\n\s*\n+/g,"\n\n").trim();
}
function countPattern(folded:string,p:TextPattern):number{p.re.lastIndex=0;return(folded.match(p.re)??[]).length;}

// ---------------------------------------------------------------- 1. clean
const HIDDEN=/[\u200B\u2060-\u2064\uFEFF\u180E\u00AD\u034F\u115F\u1160\u3164\uFFA0\u17B4\u17B5\uFE00-\uFE0D]|[\u{E0100}-\u{E01EF}]/gu;
const TAGS=/(\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F})|[\u{E0000}-\u{E007F}]/gu;
const STRAY_ZWJ=/(?<![\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F])\u200D|\u200D(?!\p{Extended_Pictographic})/gu;
const JOINING="\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\u0900-\\u0DFF";
const STRAY_ZWNJ=new RegExp(`(?<![${JOINING}])\\u200C|\\u200C(?![${JOINING}])`,"gu");
const STRAY_VS=/(?<=\p{L})[\uFE0E\uFE0F]/gu; // after a letter only: a digit + FE0F is a keycap emoji
const BIDI=/[\u202A-\u202E\u2066-\u2069]/g;
const ODD_SPACE=/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const LINE_SEP=/[\u2028\u2029]/g;
const FULLWIDTH=/[\uFF01-\uFF5E]/g;
// Arabic presentation forms (copied from PDFs) back to normal letters; \uFD3E\uFD3F and the ligatures \uFDF2 \uFDFA \uFDFD stay as written.
const PRESENTATION=/[\uFB50-\uFD3D\uFD40-\uFDEF\uFE70-\uFEFC]/g;
const LOOKALIKE_KEYS=new RegExp("["+Object.keys(HOMOGLYPHS).join("")+"]","u");

function residueEdges(text:string,folded:(s:string)=>string):{text:string;removed:number}{
  let lines=text.split("\n"),removed=0;
  const firstIndex=lines.findIndex(l=>l.trim());
  const restAfter=(i:number)=>lines.slice(i+1).some(l=>words(l).length>0);
  if(firstIndex>=0){
    const line=lines[firstIndex]!.trim(),f=folded(line).replace(/^[\s*_"'«“]+/,"");
    const starts=PATTERNS.filter(p=>p.kind==="residue_start").some(p=>{p.re.lastIndex=0;const m=p.re.exec(f);return!!m&&m.index<=2;});
    if(starts&&line.length<=200&&(/[:\uFF1A]\s*$/.test(line)||META_RE.test(f))&&restAfter(firstIndex)){lines.splice(firstIndex,1);removed++;}
  }
  for(let guard=0;guard<2;guard++){
    let lastIndex=-1;for(let i=lines.length-1;i>=0;i--)if(lines[i]!.trim()){lastIndex=i;break;}
    if(lastIndex<=0)break;
    const line=lines[lastIndex]!.trim(),f=folded(line);
    const hit=PATTERNS.filter(p=>p.kind==="residue_end").some(p=>countPattern(f,p)>0&&(p.weight>=2||META_RE.test(f)));
    if(!hit||line.length>300||!lines.slice(0,lastIndex).some(l=>words(l).length>0))break;
    lines.splice(lastIndex,1);removed++;
  }
  return{text:lines.join("\n"),removed};
}

/** Mechanical clean-up. Never changes the words a reader sees, only what hides around them. */
export function cleanText(input:string,options:{platform?:HumanizePlatform;kind?:TextKind;format?:TextFormat}={}):{text:string;changes:CleanChange[]}{
  const changes:CleanChange[]=[];
  const note=(kind:string,count:number)=>{if(count>0){const c=changes.find(x=>x.kind===kind);if(c)c.count+=count;else changes.push({kind,count});}};
  const sub=(text:string,re:RegExp,kind:string,by:string|((m:string,...a:any[])=>string)="")=>{let n=0;const out=text.replace(re,(...args:any[])=>{const r=typeof by==="string"?by:by(...(args as [string]));if(r!==args[0])n++;return r;});note(kind,n);return out;};
  let text=String(input??"").replace(/\r\n?/g,"\n");
  text=sub(text,HIDDEN,"hidden");
  text=sub(text,TAGS,"hidden",(m:string,flag?:string)=>flag??"");
  text=sub(text,STRAY_ZWJ,"hidden");
  text=sub(text,STRAY_ZWNJ,"hidden");
  text=sub(text,STRAY_VS,"hidden");
  text=sub(text,BIDI,"bidi");
  text=sub(text,ODD_SPACE,"spaces"," ");
  text=sub(text,LINE_SEP,"spaces","\n");
  text=sub(text,FULLWIDTH,"fullwidth",(m:string)=>String.fromCharCode(m.charCodeAt(0)-0xFEE0));
  text=sub(text,PRESENTATION,"presentation",(m:string)=>m.normalize("NFKC"));
  text=sub(text,/[\p{L}\p{M}]+/gu,"lookalike",(w:string)=>/[A-Za-z]/.test(w)&&LOOKALIKE_KEYS.test(w)?[...w].map(c=>HOMOGLYPHS[c]??c).join(""):w);
  const rule=platformRule(options.platform??"generic",options.kind??"post");
  if(!rule.markdown&&options.format!=="html"&&options.format!=="markdown"){
    text=sub(text,/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g,"markdown",(_m:string,a?:string,b?:string)=>a??b??"");
    text=sub(text,/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm,"markdown",(_m:string,h:string)=>h);
    text=sub(text,/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,"markdown",(_m:string,label:string,url:string)=>label+" "+url);
    text=sub(text,/`([^`\n]+)`/g,"markdown",(_m:string,code:string)=>code);
    text=sub(text,/^[ \t]*[*+][ \t]+/gm,"markdown","• ");
    text=sub(text,/^[ \t]*>[ \t]?/gm,"markdown","");
    text=sub(text,/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm,"markdown","");
  }
  if(options.format!=="html"){
    const edges=residueEdges(text,fold);
    text=edges.text;note("chatbot",edges.removed);
  }
  text=text.split("\n").map(l=>l.replace(/[ \t]+$/,"")).join("\n").replace(/\n{3,}/g,"\n\n").trim();
  return{text,changes};
}

// ---------------------------------------------------------------- 2. scan
const CURRENCY=/[$€£¥]|(?<!\p{L})(?:ريال|ر\.ع|ر\.س|درهم|دينار|جنيه|ليره|ليرة|بيسه|بيسة|omr|sar|aed|usd|kwd|qar|bhd|egp|eur|gbp)(?!\p{L})/giu;
const AR_DATES=/(?<!\p{L})(?:ال)?(?:سبت|احد|اثنين|ثلاثاء|اربعاء|خميس|جمعه|يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر|رمضان|شوال|محرم|صفر|رجب|شعبان)(?!\p{L})/gu;
const STATUS_RANK:Record<CheckStatus,number>={pass:0,warn:1,fail:2};
const WEIGHTS:Record<CheckId,number>={slop:0.28,fingerprint:0.22,burstiness:0.15,specificity:0.15,voice:0.12,platform:0.08};
const LABELS:Record<CheckId,string>={burstiness:"BURSTINESS",specificity:"SPECIFICITY",slop:"SLOP DENSITY",fingerprint:"FINGERPRINT",voice:"VOICE",platform:"PLATFORM"};

function rhythmStats(text:string){
  const sentences=sentencesOf(proseOf(text));
  const lens=sentences.map(s=>words(s).length);
  const mean=lens.length?lens.reduce((a,b)=>a+b,0)/lens.length:0;
  const sd=lens.length>1?Math.sqrt(lens.reduce((a,b)=>a+(b-mean)**2,0)/lens.length):0;
  const per=(re:RegExp)=>sentences.length?(text.match(re)??[]).length/sentences.length:0;
  return{sentences,lens,mean,sd,cov:mean?sd/mean:0,emoji:per(/\p{Extended_Pictographic}/gu),exclaim:per(/!/g),question:per(/[?؟]/g)};
}

export function scanText(input:string,options:HumanizeOptions={}):HumanizeReport{
  const platform=options.platform&&Object.hasOwn(PLATFORM_RULES,options.platform)?options.platform:"generic";
  const kind=options.kind&&TEXT_KINDS.includes(options.kind)?options.kind:"post";
  const raw=String(input??"");
  const text=options.format==="html"?htmlToText(raw):raw;
  const lang=options.lang??detectLang(text);
  const findings:HumanizeFinding[]=[];
  const checks:HumanizeCheck[]=[];
  const add=(id:CheckId,status:CheckStatus,score:number,value:string,detail:string)=>checks.push({id,label:LABELS[id],status,score:Math.round(clamp(score)),value,detail});
  const prose=proseOf(text);
  const folded=fold(prose);
  const wordCount=words(prose).length;
  const r=rhythmStats(text);
  const hits=(k:TextPattern["kind"])=>PATTERNS.filter(p=>p.kind===k).map(p=>({p,count:countPattern(folded,p)})).filter(x=>x.count>0);

  // BURSTINESS: people mix short and long sentences; models keep them even.
  if(r.lens.length<4)add("burstiness","pass",100,"—","Too short to measure sentence rhythm.");
  else{
    const openers=new Map<string,number>();
    for(const s of r.sentences){const w=fold(words(s)[0]??"");if(w)openers.set(w,(openers.get(w)??0)+1);}
    const [opener,repeats]=[...openers.entries()].sort((a,b)=>b[1]-a[1])[0]??["",0];
    // Short posts (a few lines) are naturally even, so rhythm alone never fails them.
    const long=wordCount>=60&&r.lens.length>=5;
    const [passAt,warnAt]=long?[0.35,0.25]:[0.2,0.12];
    let status:CheckStatus=r.cov>=passAt?"pass":r.cov>=warnAt||!long?"warn":"fail";
    if(repeats>=3&&repeats/r.sentences.length>=0.5){findings.push({check:"burstiness",kind:"same_opening",text:opener,count:repeats,fix:"Start sentences in different ways."});if(status==="pass")status="warn";}
    if(status!=="pass")findings.push({check:"burstiness",kind:"even_rhythm",text:`sentence lengths ${r.lens.join(", ")}`,count:r.lens.length,fix:"Mix short sentences with longer ones."});
    const score=status==="pass"?85+(r.cov-passAt)*50:status==="warn"?60:r.cov/warnAt*40;
    add("burstiness",status,Math.min(score,status==="pass"?100:status==="warn"?79:49),`CoV ${round(r.cov)}`,`${r.lens.length} sentences, ${round(r.mean,1)} words on average, spread ${round(r.sd,1)}.`);
  }

  // SPECIFICITY: numbers, prices, names, dates beat "many solutions".
  {
    let concrete=(prose.match(/\p{Nd}+/gu)??[]).length+(prose.match(CURRENCY)??[]).length+(prose.match(/«[^»\n]{1,40}»/g)??[]).length+(folded.match(AR_DATES)??[]).length;
    concrete+=(text.match(URL_RE)??[]).length+(text.match(/(?<![\p{L}\p{N}_])@[\p{L}\p{N}_.]+/gu)??[]).length;
    for(const s of r.sentences)concrete+=words(s).slice(1).filter(w=>/^[A-Z][a-z]+/.test(w)&&w!=="I").length;
    for(const k of options.keep??[])if(k.trim()&&folded.includes(fold(k.trim())))concrete++;
    const vague=hits("vague");
    const vagueCount=vague.reduce((a,x)=>a+x.count,0);
    for(const v of vague)findings.push({check:"specificity",kind:"vague",text:v.p.label,count:v.count,fix:"Name it, count it, or cut it."});
    const sentences=Math.max(1,r.sentences.length);
    const ratio=(concrete-0.7*vagueCount)/sentences;
    if(wordCount<15)add("specificity","pass",100,`${concrete} details`,"Short text.");
    else{
      const status:CheckStatus=ratio>=0.4?"pass":ratio>=0.1||(vagueCount===0)||wordCount<40?"warn":"fail";
      add("specificity",status,50+ratio*100,`${concrete} details · ${vagueCount} vague`,`${round(concrete/sentences)} concrete details per sentence.`);
    }
  }

  // SLOP DENSITY: stock phrases per 100 words.
  {
    const slop=hits("slop");
    const weighted=slop.reduce((a,x)=>a+x.p.weight*x.count,0);
    const density=wordCount?weighted/wordCount*100:0;
    for(const s of slop)findings.push({check:"slop",kind:s.p.weight>=1?"stock_phrase":"overused_word",text:s.p.label,count:s.count,...(s.p.fix?{fix:s.p.fix}:{})});
    const status:CheckStatus=weighted===0?"pass":weighted>=2&&density>=2.5?"fail":"warn";
    add("slop",status,100-density*25,`${round(density)} / 100 words`,weighted?`${slop.length} stock phrase${slop.length===1?"":"s"} found.`:"No stock phrases.");
  }

  // FINGERPRINT: what a machine leaves behind besides words.
  {
    const cleaned=cleanText(raw,{platform,kind,...(options.format?{format:options.format}:{})});
    const got=(k:string)=>cleaned.changes.find(c=>c.kind===k)?.count??0;
    const fails:Array<[string,number,string]>=[["hidden",got("hidden"),"hidden characters (zero-width, tags, selectors)"],["bidi",got("bidi"),"direction-changing control characters"],["lookalike",got("lookalike"),"words with look-alike Cyrillic/Greek letters"],["chatbot",got("chatbot"),"chatbot leftovers (\"Sure! Here's…\", \"I hope this helps\")"]];
    const warns:Array<[string,number,string]>=[["spaces",got("spaces"),"unusual spaces (no-break, narrow, thin)"],["markdown",got("markdown"),`markdown ${PLATFORM_RULES[platform].label} will show as symbols`],["presentation",got("presentation")+got("fullwidth"),"presentation-form or full-width letters (copied from a PDF or a chatbot)"]];
    const dashes=(text.match(/—|\s–\s/g)??[]).length;
    if(lang==="en"?dashes>=2&&dashes/Math.max(1,wordCount)*100>0.8:dashes>=1)warns.push(["em_dash",dashes,"em dashes (—), a common machine habit"]);
    const emojiLines=text.split("\n").filter(l=>EMOJI.test([...graphemes.segment(l.trim())][0]?.segment??"")).length;
    if(emojiLines>=3)warns.push(["emoji_bullets",emojiLines,"lines that all start with an emoji (template look)"]);
    const bangs=(text.match(/!/g)??[]).length;
    if(bangs>=3&&r.exclaim>0.5)warns.push(["exclamations",bangs,"many exclamation marks"]);
    for(const [k,c,label] of [...fails,...warns])if(c>0)findings.push({check:"fingerprint",kind:k,text:label,count:c,...(["hidden","bidi","lookalike","chatbot","spaces","presentation","markdown"].includes(k)?{fix:"Removed by the clean step."}:{})});
    const nFail=fails.filter(f=>f[1]>0).length,nWarn=warns.filter(w=>w[1]>0).length;
    add("fingerprint",nFail?"fail":nWarn?"warn":"pass",100-40*nFail-12*nWarn,nFail+nWarn?`${nFail+nWarn} trace${nFail+nWarn===1?"":"s"}`:"clean",nFail+nWarn?[...fails,...warns].filter(x=>x[1]>0).map(x=>x[2]).join("; "):"No hidden characters or machine traces.");
  }

  // VOICE: hedging and stock rhetoric, and, with a voice profile, how far it drifts from the owner's own posts.
  {
    const hedges=hits("hedge"),tells=hits("voice");
    const hedgeCount=hedges.reduce((a,x)=>a+x.count,0),tellCount=tells.reduce((a,x)=>a+x.count,0);
    for(const h of hedges)findings.push({check:"voice",kind:"hedge",text:h.p.label,count:h.count,fix:"Say it plainly."});
    for(const t of tells)findings.push({check:"voice",kind:"stock_rhetoric",text:t.p.label,count:t.count,fix:"Start with the point."});
    const sentences=Math.max(1,r.sentences.length);
    const rate=(hedgeCount*0.5+tellCount)/sentences;
    let drift=0,banned=0;
    const voice=options.voice;
    if(voice?.samples?.length&&r.sentences.length>=2){
      const own=rhythmStats(voice.samples.join("\n\n"));
      if(own.sentences.length>=2){
        const ratio=r.mean/Math.max(1,own.mean);
        if(ratio>2||ratio<0.5){drift++;findings.push({check:"voice",kind:"sentence_length",text:`${round(r.mean,1)} words per sentence; your own posts: ${round(own.mean,1)}`,count:1,fix:ratio>2?"Shorter sentences, like your own posts.":"Fuller sentences, like your own posts."});}
        if(r.emoji>own.emoji*3+0.5){drift++;findings.push({check:"voice",kind:"emoji",text:"far more emoji than your own posts",count:1,fix:"Use emoji the way you usually do."});}
        if(r.exclaim>own.exclaim*3+0.5){drift++;findings.push({check:"voice",kind:"exclamations",text:"far more exclamation marks than your own posts",count:1,fix:"Calmer punctuation, like your own posts."});}
      }
    }
    for(const word of voice?.avoid??[]){
      const w=fold(word.trim());if(!w)continue;
      const c=folded.split(w).length-1;
      if(c>0){banned+=c;findings.push({check:"voice",kind:"avoid",text:word,count:c,fix:"You asked never to use this."});}
    }
    const status:CheckStatus=banned?"fail":(hedgeCount+tellCount>=4&&rate>0.6)?"fail":(rate>0.25||drift>0||tellCount>0)?"warn":"pass";
    add("voice",status,100-rate*80-drift*15-banned*40,voice?.samples?.length?`profile · drift ${drift}`:`${tellCount+hedgeCount} tells`,voice?.samples?.length?"Compared with your own posts.":"No voice profile yet: checked for generic chatbot voice.");
  }

  // PLATFORM: what the platform enforces or shows.
  const rule=platformRule(platform,kind);
  const length=measureLength(text,rule.unit);
  const hashtags=(text.match(HASHTAG)??[]).length;
  {
    const problems:string[]=[];let status=("pass" as CheckStatus);
    const bump=(s:CheckStatus,why:string,kindName:string,count:number,fix?:string)=>{problems.push(why);if(STATUS_RANK[s]>STATUS_RANK[status])status=s;findings.push({check:"platform",kind:kindName,text:why,count,...(fix?{fix}:{})});};
    if(!words(text).length)bump("warn","Empty text.","empty",1);
    if(rule.max!==undefined&&length>rule.max)bump("fail",`${length} of ${rule.max} ${rule.unit==="x"?"weighted characters":rule.unit} allowed on ${rule.label}.`,"too_long",length-rule.max,"Shorten it.");
    else if(rule.advice!==undefined&&length>rule.advice)bump("warn",`${length} characters; about ${rule.advice} reads best here.`,"long",length-rule.advice,"Shorten it.");
    if(rule.mediaCaption!==undefined&&length>rule.mediaCaption)bump("warn",`With a photo or video, ${rule.label} cuts captions at ${rule.mediaCaption} characters.`,"caption",length-rule.mediaCaption);
    if(rule.hashtagsMax!==undefined&&hashtags>rule.hashtagsMax)bump("fail",`${hashtags} hashtags; ${rule.label} allows ${rule.hashtagsMax}.`,"hashtags",hashtags-rule.hashtagsMax,"Keep the best ones.");
    else if(rule.hashtagsAdvice!==undefined&&hashtags>rule.hashtagsAdvice)bump("warn",rule.hashtagsAdvice===0?`Hashtags do not belong in a ${kind.replace("_"," ")}.`:`${hashtags} hashtags; ${rule.hashtagsAdvice} or fewer read better on ${rule.label}.`,"hashtags",hashtags-rule.hashtagsAdvice);
    const final:CheckStatus=status;
    add("platform",final,final==="fail"?20:final==="warn"?70:100,rule.max!==undefined?`${length}/${rule.max}`:rule.advice!==undefined?`${length}/~${rule.advice}`:String(length),problems.join(" ")||rule.note||`${rule.label}: fits.`);
  }

  const humanScore=Math.round(checks.reduce((a,c)=>a+WEIGHTS[c.id]*c.score,0));
  const fails=checks.filter(c=>c.status==="fail").length,warns=checks.filter(c=>c.status==="warn").length;
  return{verdict:fails?"fail":warns>=2?"review":"pass",humanScore,lang,platform,kind,checks,findings,
    stats:{words:wordCount,sentences:r.sentences.length,length,unit:rule.unit,...(rule.max!==undefined?{limit:rule.max}:{}),...(rule.advice!==undefined?{advice:rule.advice}:{}),hashtags}};
}

// ---------------------------------------------------------------- facts and protected passages
/** Passages a rewrite must return exactly: they become ⟦n⟧ markers while the model works. */
export function protectSpans(text:string):{masked:string;spans:string[]}{
  const spans:string[]=[];
  const mark=(m:string)=>{spans.push(m);return`⟦${spans.length}⟧`;};
  let masked=text;
  masked=masked.replace(/\uFD3F[^\uFD3E]*\uFD3E|\uFD3E[^\uFD3F]*\uFD3F/g,mark);
  masked=masked.replace(/```[\s\S]*?```|`[^`\n]+`/g,mark);
  // A fully vowelled line is scripture, hadith or poetry: quoted, never reworded.
  masked=masked.split("\n").map(line=>{
    const letters=(line.match(/[\u0621-\u064A]/g)??[]).length,marks=(line.match(/[\u064B-\u0652\u0670]/g)??[]).length;
    return letters>=12&&marks/letters>=0.35?mark(line):line;
  }).join("\n");
  masked=masked.replace(URL_RE,m=>{const url=m.replace(/[.,;:!?)\]]+$/,"");return mark(url)+m.slice(url.length);});
  masked=masked.replace(/[\w.+-]+@[\w-]+\.[\w.-]*\w/g,mark);
  masked=masked.replace(DISCLOSURE_RE,mark);
  masked=masked.replace(/«[^»\n]{1,300}»|“[^”\n]{1,300}”|"[^"\n]{2,300}"/g,mark);
  return{masked,spans};
}
function restoreSpans(text:string,spans:string[]):{text:string;missing:number[]}{
  const missing:number[]=[];
  let out=text.replace(/\[\[(\d+)\]\]|⟦\s*(\d+)\s*⟧/g,(_,a,b)=>`⟦${a??b}⟧`);
  spans.forEach((span,i)=>{const m=`⟦${i+1}⟧`;const n=out.split(m).length-1;if(n!==1)missing.push(i+1);else out=out.replace(m,()=>span);});
  return{text:out.replace(/⟦\d+⟧/g,""),missing};
}
/** The facts a rewrite may not lose: numbers, phones, links, e-mails, @mentions, #hashtags, acronyms and the owner's own terms. */
export function extractFacts(text:string,keep:string[]=[]):Map<string,Set<string>>{
  const out=new Map<string,Set<string>>();
  const put=(kind:string,value:string)=>{if(!value)return;if(!out.has(kind))out.set(kind,new Set());out.get(kind)!.add(value);};
  let t=text.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x0660)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x06F0)).replace(/٫/g,".").replace(/٬/g,",");
  t=t.replace(URL_RE,m=>{put("link",m.replace(/[.,;:!?)\]]+$/,"").toLowerCase());return" ";});
  t=t.replace(/[\w.+-]+@[\w-]+\.[\w.-]*\w/g,m=>{put("email",m.toLowerCase());return" ";});
  t=t.replace(/(?<![\p{L}\p{N}_])@[\p{L}\p{N}_.]*[\p{L}\p{N}_]/gu,m=>{put("mention",m.toLowerCase());return" ";});
  t=t.replace(HASHTAG,m=>{put("hashtag",fold(m));return" ";});
  // Phones: international (+968 9123 4567, 00968…) or one long run of digits (91234567).
  t=t.replace(/(?<![\d\w])(?:\+|00)\d[\d\s-]{6,}\d(?!\d)|(?<![\d.,])\d{8,15}(?![\d.,])/g,m=>{put("phone",m.replace(/\D/g,"").replace(/^00/,""));return" ";});
  t.replace(/\d+(?:[.,]\d+)*/g,m=>{put("number",/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(m)?m.replace(/,/g,""):m);return m;});
  t.replace(/\b[A-Z][A-Z0-9]{1,}\b/g,m=>{if(!["OK","AND","OR","THE","FOR","NOT","YES","NO"].includes(m))put("acronym",m);return m;});
  const folded=fold(text);
  for(const k of keep){const f=fold(k.trim());if(f&&folded.includes(f))put("keep",k.trim());}
  return out;
}
export function diffFacts(before:string,after:string,keep:string[]=[]):FactLoss[]{
  const a=extractFacts(before,keep),b=extractFacts(after,keep),lost:FactLoss[]=[];
  const afterFolded=fold(after);
  for(const [kind,values] of a)for(const value of values){
    if(b.get(kind)?.has(value))continue;
    if(kind==="number"&&[...(b.get("phone")??[])].some(x=>x.includes(value)))continue;
    if(kind==="phone"&&after.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x0660)).replace(/\D/g,"").includes(value))continue;
    if(kind==="keep"&&afterFolded.includes(fold(value)))continue;
    lost.push({kind,value});
  }
  return lost;
}

// ---------------------------------------------------------------- voice profile
const storeDir=(env:NodeJS.ProcessEnv=process.env)=>env.LAYANX_STORE_DIR?.trim()||".layanx";
export const voiceFile=(env:NodeJS.ProcessEnv=process.env)=>path.join(storeDir(env),"humanizer-voice.json");
const clip=(v:unknown,n:number)=>typeof v==="string"?v.trim().slice(0,n):"";
/** Checks and trims a voice profile from the owner (or a tool payload). */
export function normalizeVoice(input:unknown):VoiceProfile{
  const v=(input&&typeof input==="object"?input:{}) as Record<string,unknown>;
  const list=(x:unknown,max:number,len:number)=>Array.isArray(x)?x.map(i=>clip(i,len)).filter(Boolean).slice(0,max):[];
  const person=v.person==="i"||v.person==="we"?v.person:"";
  return{samples:list(v.samples,5,1500).map(s=>cleanText(s).text).filter(Boolean),...(clip(v.dialect,80)?{dialect:clip(v.dialect,80)}:{}),...(clip(v.tone,80)?{tone:clip(v.tone,80)}:{}),person,avoid:list(v.avoid,30,40),prefer:list(v.prefer,30,40)};
}
export function loadVoice(env:NodeJS.ProcessEnv=process.env):VoiceProfile|null{
  try{
    const raw=JSON.parse(fs.readFileSync(voiceFile(env),"utf8"));
    return{...normalizeVoice(raw),...(typeof raw?.updatedAt==="string"?{updatedAt:raw.updatedAt}:{})};
  }catch{return null;}
}
export function saveVoice(input:unknown,env:NodeJS.ProcessEnv=process.env):VoiceProfile{
  const profile={...normalizeVoice(input),updatedAt:new Date().toISOString()};
  fs.mkdirSync(storeDir(env),{recursive:true});
  writeFileAtomic(voiceFile(env),JSON.stringify(profile,null,2));
  return profile;
}

// ---------------------------------------------------------------- 3. rewrite
export type HumanizerMode="rewrite"|"clean"|"off";
/** LAYANX_HUMANIZER: rewrite (default) | clean (mechanical only) | off. */
export function humanizerMode(env:NodeJS.ProcessEnv=process.env):HumanizerMode{
  const v=(env.LAYANX_HUMANIZER??"").trim().toLowerCase();
  return v==="off"||v==="false"||v==="0"?"off":v==="clean"?"clean":"rewrite";
}
const better=(a:HumanizeReport,b:HumanizeReport)=>{const rank={pass:2,review:1,fail:0};return rank[a.verdict]>rank[b.verdict]||(rank[a.verdict]===rank[b.verdict]&&a.humanScore>=b.humanScore+3);};

function buildPrompt(masked:string,report:HumanizeReport,options:HumanizeOptions,feedback:string[]):string{
  const rule=platformRule(report.platform,report.kind);
  const language=report.lang==="ar"?"Arabic":report.lang==="en"?"English":"the same mix of Arabic and English";
  const lines:string[]=[
    `You edit copy so it reads like a real person wrote it. Rewrite the TEXT for ${rule.label}${report.kind!=="post"?` (${report.kind.replace("_"," ")})`:""}.`,
    `Write in ${language}${options.voice?.dialect?`, dialect: ${options.voice.dialect}`:""}. Keep the meaning and every fact: numbers, prices, dates, names, @mentions and #hashtags exactly as written.`,
    "Markers like ⟦1⟧ stand for text that must not change: keep every marker exactly once, where it fits.",
    "Do not add facts, claims, prices, promises, emoji or hashtags that are not in the text. Do not explain anything."
  ];
  if(rule.max!==undefined)lines.push(`Stay under ${rule.max} ${rule.unit==="x"?"weighted characters":rule.unit}.`);
  else if(rule.advice!==undefined)lines.push(`Aim for about ${rule.advice} characters or fewer.`);
  if(!rule.markdown)lines.push("Plain text only: no markdown, no headings, no bold.");
  const fixes=new Set<string>();
  for(const f of report.findings){
    if(f.check==="slop")fixes.add(`Remove the stock phrase "${f.text}"${f.fix?` (${f.fix})`:""}.`);
    else if(f.check==="specificity")fixes.add(`Replace the vague "${f.text}" with a concrete detail already in the text, or cut it.`);
    else if(f.check==="voice"&&(f.kind==="hedge"||f.kind==="stock_rhetoric"))fixes.add(`Drop "${f.text}": say it plainly.`);
    else if(f.check==="voice"&&f.kind==="avoid")fixes.add(`Never use "${f.text}".`);
    else if(f.fix&&f.check!=="fingerprint")fixes.add(f.fix);
    else if(f.kind==="em_dash")fixes.add("No em dashes (—); use commas or full stops.");
    else if(f.kind==="emoji_bullets")fixes.add("Do not start every line with an emoji.");
    else if(f.kind==="exclamations")fixes.add("Use at most one exclamation mark.");
  }
  if(fixes.size)lines.push("Fix what the checker found:",...[...fixes].slice(0,14).map(x=>"- "+x));
  const v=options.voice;
  if(v){
    if(v.tone)lines.push(`Tone: ${v.tone}.`);
    if(v.person)lines.push(v.person==="we"?"Write as \"we\" (the business).":"Write as \"I\" (the owner).");
    if(v.prefer.length)lines.push(`Words the owner likes: ${v.prefer.slice(0,12).join(", ")}.`);
    if(v.samples.length)lines.push("How the owner really writes (match this voice, do not copy the content):",...v.samples.slice(0,3).map(s=>'"""'+s.slice(0,600)+'"""'));
  }
  if(feedback.length)lines.push("Your previous attempt was refused:",...feedback.map(x=>"- "+x));
  lines.push("Return only the rewritten text.","TEXT:",'"""',masked,'"""');
  return lines.join("\n");
}
function unwrap(raw:string):string{
  let t=String(raw??"").trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/,"$1").trim();
  if(/^"""[\s\S]*"""$/.test(t))t=t.slice(3,-3).trim();
  for(const [a,b] of [['"','"'],["«","»"],["“","”"]] as const)if(t.startsWith(a)&&t.endsWith(b)&&t.length>2&&!t.slice(1,-1).includes(b))t=t.slice(1,-1).trim();
  return t.replace(/^(?:TEXT|النص)\s*:\s*/i,"");
}

/** Clean, check, and when the checks fail, rewrite with the local model and verify the result. */
export async function humanizeText(input:string,options:HumanizeOptions={},generate?:GenerateText):Promise<HumanizeResult>{
  const original=String(input??"");
  const scanOptions={...options};
  const before=scanText(original,scanOptions);
  const cleaned=cleanText(original,{...(options.platform?{platform:options.platform}:{}),...(options.kind?{kind:options.kind}:{}),...(options.format?{format:options.format}:{})});
  let best={text:cleaned.text,report:scanText(cleaned.text,scanOptions)};
  const result=(extra:Partial<HumanizeResult>):HumanizeResult=>({text:best.text,original,rewritten:false,cleaned:cleaned.changes,before,after:best.report,attempts:0,lost:[],...extra});
  if(options.format==="html")return result({note:"html_check_only"});
  if(best.report.verdict==="pass")return result({note:"already_human"});
  if(!generate)return result({note:"no_model"});
  const {masked,spans}=protectSpans(best.text);
  if(words(masked.replace(/⟦\d+⟧/g," ")).length<4)return result({note:"protected"});
  const keep=options.keep??[];
  const maxAttempts=Math.max(1,Math.min(options.maxAttempts??2,4));
  const tokens=Math.min(2000,Math.ceil(masked.length/2)+300);
  let attempts=0,rewritten=false,lastLost:FactLoss[]=[],note:string|undefined,feedback:string[]=[];
  let target=best.report;
  for(;attempts<maxAttempts;){
    attempts++;
    let raw:string;
    try{raw=await generate(buildPrompt(masked,target,options,feedback),tokens);}
    catch(error){note="model_error: "+(error instanceof Error?error.message:String(error)).slice(0,160);break;}
    const restored=restoreSpans(unwrap(raw),spans);
    feedback=[];
    if(restored.missing.length){feedback.push(`Markers ${restored.missing.map(i=>`⟦${i}⟧`).join(" ")} were dropped or repeated; keep every marker exactly once.`);continue;}
    const candidate=cleanText(restored.text,{...(options.platform?{platform:options.platform}:{}),...(options.kind?{kind:options.kind}:{})}).text;
    const lost=diffFacts(cleaned.text,candidate,keep);
    if(lost.length){lastLost=lost;feedback.push(`You lost or changed: ${lost.slice(0,8).map(l=>l.value).join(", ")}. Keep them exactly.`);continue;}
    if(!words(candidate).length){feedback.push("You returned an empty text.");continue;}
    const report=scanText(candidate,scanOptions);
    if(better(report,best.report)){best={text:candidate,report};rewritten=true;lastLost=[];}
    if(best.report.verdict==="pass")break;
    target=report;
    const still=report.checks.filter(c=>c.status!=="pass").map(c=>`${c.label}: ${c.detail}`);
    if(still.length)feedback.push("Still failing: "+still.join(" | "));
  }
  if(!rewritten&&!note)note=lastLost.length?"rewrite_lost_facts":"rewrite_not_better";
  return result({rewritten,attempts,lost:rewritten?[]:lastLost,...(note?{note}:{})});
}

// ---------------------------------------------------------------- helpers for the content paths
/** One text for several platforms is written for the strictest of them (the shortest limit). */
export function strictestPlatform(platforms:readonly string[]):HumanizePlatform{
  const known=platforms.filter((p):p is HumanizePlatform=>Object.hasOwn(PLATFORM_RULES,p)&&p!=="generic");
  return known.sort((a,b)=>(PLATFORM_RULES[a].max??Infinity)-(PLATFORM_RULES[b].max??Infinity))[0]??"generic";
}
/** The hashtags a draft may carry: the platform's hard limit (Instagram: 5), never more. */
export function hashtagLimit(platforms:readonly string[]):number{
  return Math.min(...platforms.map(p=>Object.hasOwn(PLATFORM_RULES,p)?PLATFORM_RULES[p as HumanizePlatform].hashtagsMax??Infinity:Infinity),Infinity);
}
export function qualityOf(report:HumanizeReport,rewritten=false,note?:string):ContentQuality{
  return{verdict:report.verdict,humanScore:report.humanScore,rewritten,platform:report.platform,checks:report.checks.map(c=>({id:c.id,status:c.status})),...(note?{note}:{}),checkedAt:new Date().toISOString()};
}
