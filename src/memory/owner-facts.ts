import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";

/**
 * What the owner asked LayanX to remember about them ("remember that my carrier is SMSA"), on disk, so it survives a restart
 * and is used the next time the owner asks. Only the owner's own words are stored, never something a page or an email said,
 * and never a secret (a password, a card number, a key): those are refused, not stored.
 */
export interface OwnerFact{id:string;text:string;createdAt:string}
const norm=(t:string)=>t.toLowerCase().replace(/[ً-ْـ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
const STOP=new Set(["ان","انا","انني","اني","هو","هي","في","من","على","الى","عن","مع","ما","ماذا","هل","كيف","متى","اين","وش","ايش","شو","لي","عندي","عني","تذكر","the","a","an","is","are","my","me","i","of","to","in","on","what","which","who","how","when","where","do","does","that","about","remember"]);
const terms=(t:string)=>[...new Set(norm(t).split(" ").map(w=>w.replace(/^(?:ال|و|ب|ل|ف)(?=\p{L}{3,})/u,"")).filter(w=>w.length>1&&!STOP.has(w)))];

/** A secret in the fact: refused (LayanX keeps keys in its vault, entered by the owner on the panel). */
export function looksSecret(text:string):boolean{
  const t=norm(text);
  if(/(?:كلمه (?:السر|المرور)|باسورد|الرقم السري|password|passcode|pin\b|api ?key|token|secret|رمز التحقق|otp|cvv)/u.test(t))return true;
  if((text.replace(/[\s-]/g,"").match(/\d{12,19}/)??[]).length)return true;
  return/(?:sk-|ghp_|xox[bp]-|AKIA)[A-Za-z0-9]{8,}/.test(text);
}
export type FactCommand={kind:"remember";fact:string}|{kind:"forget";what:string}|{kind:"list"};
export function factCommand(text:string):FactCommand|null{
  const t=text.trim();
  const remember=/^(?:من فضلك\s+)?(?:تذكر|تذكّر|احفظ(?: معلومه| معلومة)?|سجل عندك|خلك فاكر|remember)(?:\s+(?:ان|أن|إن|that))?\s*[:：]?\s*(.+)$/isu.exec(t);
  // «تذكر أني لا أنشر...» was cut to «ي لا أنشر...» (found 2026-11-13): the first person is kept as «أنا».
  const firstPerson=/^(?:من فضلك\s+)?(?:تذكر|تذكّر|remember)\s+(?:أنني|إنني|انني|أني|إني|اني)\s+(.+)$/isu.exec(t);
  if(firstPerson&&!/[?؟]\s*$/.test(t))return{kind:"remember",fact:"أنا "+firstPerson[1]!.trim().replace(/[.。]+$/,"")};
  if(remember&&remember[1]!.trim().length>=4&&!/[?؟]\s*$/.test(t))return{kind:"remember",fact:remember[1]!.trim().replace(/[.。]+$/,"")};
  const forget=/^(?:انسى|انسَ?|احذف(?:معلومه|معلومة)|forget)(?:\s+(?:ان|أن|that))?\s*[:：]?\s*(.+)$/isu.exec(t);
  if(forget)return{kind:"forget",what:forget[1]!.trim()};
  if(/(?:ماذا|وش|ايش|شو|what)\s+(?:تتذكر|تعرف|تحفظ|do you (?:remember|know))\s+(?:عني|about me)/iu.test(norm(t)+" ")||/^(?:ماذا|وش|ايش|شو) (?:تتذكر|تعرف) عني/u.test(norm(t)))return{kind:"list"};
  return null;
}

export class OwnerFacts{
  constructor(private readonly file:string){}
  static at(storeDir=process.env.LAYANX_STORE_DIR?.trim()||".layanx"){return new OwnerFacts(path.join(storeDir,"owner-facts.json"));}
  list():OwnerFact[]{try{const d=JSON.parse(fs.readFileSync(this.file,"utf8"));return Array.isArray(d.facts)?d.facts:[];}catch{return[];}}
  private save(facts:OwnerFact[]){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+"."+randomUUID()+".tmp";fs.writeFileSync(tmp,JSON.stringify({facts},null,2),{mode:0o600});fs.renameSync(tmp,this.file);}
  /** Stores the fact; a newer fact about the same thing replaces the older one ("my carrier is SMSA" -> "my carrier is Aramex"). */
  remember(text:string):{stored:OwnerFact;replaced?:OwnerFact}{
    if(looksSecret(text))throw new Error("secret");
    const facts=this.list(),mine=terms(text);
    const same=facts.find(f=>{const theirs=terms(f.text);const shared=theirs.filter(w=>mine.includes(w)).length;return shared>=2&&shared>=Math.min(theirs.length,mine.length)-1;});
    const stored={id:randomUUID(),text:text.slice(0,500),createdAt:new Date().toISOString()};
    this.save([...facts.filter(f=>f!==same),stored].slice(-200));
    return{stored,...(same?{replaced:same}:{})};
  }
  forget(what:string):OwnerFact|null{
    const facts=this.list();const best=this.relevant(what,1,facts)[0];
    if(!best)return null;
    this.save(facts.filter(f=>f.id!==best.id));return best;
  }
  /** The facts that share words with the question, best first. */
  relevant(question:string,limit=5,facts=this.list()):OwnerFact[]{
    const q=terms(question);if(!q.length)return[];
    return facts.map(f=>{const ft=terms(f.text);return{f,score:q.filter(w=>ft.some(x=>x===w||x.startsWith(w)||w.startsWith(x))).length};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.f.createdAt.localeCompare(a.f.createdAt)).slice(0,limit).map(x=>x.f);
  }
}

/** Replies to the owner's remember / forget / list commands. */
export function factReply(store:OwnerFacts,command:FactCommand,arabicReply:boolean):string{
  const A=arabicReply;
  if(command.kind==="remember"){
    try{const r=store.remember(command.fact);return A?`حفظتُ: «${r.stored.text}»${r.replaced?`، بدل ما كان: «${r.replaced.text}»`:""}.`:`Saved: "${r.stored.text}"${r.replaced?`, replacing: "${r.replaced.text}"`:""}.`;}
    catch{return A?"لا أحفظ كلمات السر أو أرقام البطاقات أو المفاتيح في الذاكرة. أدخل المفاتيح في اللوحة (الإعداد ← الأسرار) حيث تُشفَّر.":"I do not keep passwords, card numbers or keys in memory. Enter keys on the panel (Setup -> Secrets), where they are encrypted.";}
  }
  if(command.kind==="forget"){const gone=store.forget(command.what);return gone?(A?`نسيتُ: «${gone.text}».`:`Forgotten: "${gone.text}".`):(A?"لا أجد معلومة كهذه عندي.":"I have nothing like that saved.");}
  const facts=store.list();
  if(!facts.length)return A?"لم تطلب مني تذكّر شيء بعد. قل: «تذكر أن…».":"You have not asked me to remember anything yet. Say \"remember that…\".";
  return(A?"ما طلبتَ مني تذكّره:\n":"What you asked me to remember:\n")+facts.map(f=>"- "+f.text).join("\n");
}
/** The facts relevant to a message, as a block for a model prompt. */
export function factsForPrompt(store:OwnerFacts,message:string):string{
  const found=store.relevant(message,5);
  return found.length?"What the owner told you to remember (use it when it answers the question; it is the owner's own information):\n"+found.map(f=>"- "+f.text).join("\n"):"";
}
