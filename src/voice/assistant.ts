import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import type {LayanXCore} from "../core/orchestrator.js";
import {normalizeArabic,tokenize} from "../providers/tool-selection.js";

/**
 * The "Jarvis" layer: one conversational entry point for voice and text.
 *
 *  - answers questions and small talk with the configured model (local first)
 *  - turns requests into real work through the existing agent gateway, so every
 *    task keeps permissions, approvals, verification and audit
 *  - gives spoken status reports and an optional daily briefing
 *  - Arabic and English: replies in the language the owner spoke
 *
 * It never approves anything by voice. Protected actions pause and wait for the
 * owner in the Control Center.
 */
export type AssistantLang="ar"|"en";
export type AssistantIntent="answer"|"task"|"report"|"time"|"error";

export interface AssistantHistoryItem{role:"user"|"assistant";text:string}
export interface AssistantTurnInput{
  text:string;
  lang?:AssistantLang|"auto";
  projectId?:string;
  history?:AssistantHistoryItem[];
  /** When false, requests to act are described but not executed. */
  allowTasks?:boolean;
}
export interface AssistantTaskSummary{completed:boolean;paused:boolean;status?:string;reason?:string}
export interface AssistantTurnResult{
  ok:boolean;
  lang:AssistantLang;
  intent:AssistantIntent;
  reply:string;
  missionId?:string;
  goal?:string;
  task?:AssistantTaskSummary;
  report?:AssistantReport;
}

export interface AssistantSnapshot{
  missions:Array<{id:string;goal:string;status:string;createdAt:string;projectId?:string}>;
  approvals:Array<{id:string;tool:string;action:string;missionId:string;approved:boolean}>;
  schedules:number;
}
export interface AssistantReport{
  generatedAt:string;
  projectId:string;
  windowHours:number;
  counts:{total:number;completed:number;failed:number;active:number;blocked:number;cancelled:number};
  pendingApprovals:number;
  schedules:number;
  recentFailures:string[];
  text:Record<AssistantLang,string>;
}

export interface AssistantDeps{
  /** Must return JSON text (Ollama: format=json via the "reasoning" capability). */
  decide(prompt:string):Promise<string>;
  runTask(goal:string,projectId:string):Promise<Record<string,unknown>>;
  snapshot(projectId:string):AssistantSnapshot;
  now?():Date;
}

const ARABIC=/[\u0600-\u06FF]/;
export const detectLang=(text:string):AssistantLang=>ARABIC.test(text)?"ar":"en";

const REPORT_WORDS=new Set(["تقرير","تقريري","ملخص","لخص","موجز","report","briefing","brief","status","summary","summarize"].map(normalizeArabic));
const REPORT_PHRASES=/وضع المهام|حاله المهام|ما الجديد|what'?s new|how are things/i;
// "write a sales report and email it" is a task, not a status request.
const CREATE_WORDS=new Set(["اكتب","أنشئ","ارسل","جهز","حضر","اعد","صمم","انشر","write","create","send","draft","prepare","generate","email","publish","make"].map(normalizeArabic));
const TIME_AR=/كم الساعه|ما الوقت|كم الوقت|ما التاريخ|تاريخ اليوم|اي يوم اليوم/;
const TIME_EN=/\bwhat(?:'s| is) the (?:time|date)\b|\bwhat time is it\b|\btoday'?s date\b|\bwhat day is (?:it|today)\b/i;

function clean(text:string,max:number):string{
  return text.replace(/[*#`_>|]+/g," ").replace(/\s+/g," ").trim().slice(0,max);
}

function extractObject(text:string):Record<string,unknown>|null{
  const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,"").replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/,"").trim();
  const candidates=[cleaned];
  const start=cleaned.indexOf("{"),end=cleaned.lastIndexOf("}");
  if(start>=0&&end>start)candidates.push(cleaned.slice(start,end+1));
  for(const c of candidates){
    try{const v=JSON.parse(c) as unknown;if(v&&typeof v==="object"&&!Array.isArray(v))return v as Record<string,unknown>;}catch{}
  }
  return null;
}

const T={
  ar:{
    noModel:"لا يوجد نموذج ذكاء اصطناعي متاح الآن. شغّل Ollama أو أضف مفتاح خدمة من صفحة الإعداد.",
    empty:"لم أسمع شيئاً. أعد المحاولة.",
    done:(g:string)=>`تم. أنهيت المهمة: ${g}.`,
    paused:"المهمة تحتاج موافقتك قبل أن أكمل. افتح الموافقات في لوحة التحكم.",
    failed:(r:string)=>`لم أستطع إكمال المهمة. ${r}`,
    tasksOff:(g:string)=>`هذا يحتاج تنفيذ مهمة: ${g}. فعّل تنفيذ المهام في المساعد إن أردت ذلك.`,
    time:(d:Date)=>`الساعة الآن ${d.toLocaleTimeString("ar",{hour:"numeric",minute:"2-digit"})}، ${d.toLocaleDateString("ar",{weekday:"long",day:"numeric",month:"long"})}.`
  },
  en:{
    noModel:"No AI model is available right now. Start Ollama or add a service key on the setup page.",
    empty:"I didn't catch that. Please try again.",
    done:(g:string)=>`Done. I finished: ${g}.`,
    paused:"This task needs your approval before I continue. Open Approvals in the Control Center.",
    failed:(r:string)=>`I couldn't finish the task. ${r}`,
    tasksOff:(g:string)=>`That needs a task: ${g}. Turn on task execution in the assistant if you want me to do it.`,
    time:(d:Date)=>`It's ${d.toLocaleTimeString("en",{hour:"numeric",minute:"2-digit"})}, ${d.toLocaleDateString("en",{weekday:"long",day:"numeric",month:"long"})}.`
  }
};

export class VoiceAssistant{
  private readonly deps:AssistantDeps;
  constructor(deps:AssistantDeps){this.deps=deps;}
  private now(){return this.deps.now?.()??new Date();}

  report(projectId="default",windowHours=24):AssistantReport{
    const snap=this.deps.snapshot(projectId);
    const since=this.now().getTime()-windowHours*3_600_000;
    const recent=snap.missions.filter(m=>(!m.projectId||m.projectId===projectId)&&Date.parse(m.createdAt)>=since);
    const counts={total:recent.length,completed:0,failed:0,active:0,blocked:0,cancelled:0};
    for(const m of recent){
      if(m.status==="completed")counts.completed++;
      else if(m.status==="failed")counts.failed++;
      else if(m.status==="blocked")counts.blocked++;
      else if(m.status==="cancelled")counts.cancelled++;
      else counts.active++;
    }
    const pendingApprovals=snap.approvals.filter(a=>!a.approved).length;
    const recentFailures=recent.filter(m=>m.status==="failed").slice(-3).map(m=>clean(m.goal,80));
    const ar=[
      counts.total?`خلال آخر ${windowHours} ساعة: ${counts.total} مهمة، اكتمل منها ${counts.completed}، وفشلت ${counts.failed}، وقيد التنفيذ ${counts.active}.`:`لا توجد مهام خلال آخر ${windowHours} ساعة.`,
      pendingApprovals?`هناك ${pendingApprovals} موافقة تنتظرك.`:"لا توجد موافقات معلّقة.",
      snap.schedules?`المهام المجدولة: ${snap.schedules}.`:"",
      recentFailures.length?`آخر ما فشل: ${recentFailures.join("، ")}.`:""
    ].filter(Boolean).join(" ");
    const en=[
      counts.total?`In the last ${windowHours} hours: ${counts.total} tasks, ${counts.completed} completed, ${counts.failed} failed, ${counts.active} in progress.`:`No tasks in the last ${windowHours} hours.`,
      pendingApprovals?`${pendingApprovals} approval${pendingApprovals===1?" is":"s are"} waiting for you.`:"No approvals are waiting.",
      snap.schedules?`Scheduled jobs: ${snap.schedules}.`:"",
      recentFailures.length?`Latest failures: ${recentFailures.join(", ")}.`:""
    ].filter(Boolean).join(" ");
    return{generatedAt:this.now().toISOString(),projectId,windowHours,counts,pendingApprovals,schedules:snap.schedules,recentFailures,text:{ar,en}};
  }

  async turn(input:AssistantTurnInput):Promise<AssistantTurnResult>{
    const text=clean(String(input.text??""),2000);
    const lang:AssistantLang=input.lang==="ar"||input.lang==="en"?input.lang:detectLang(text);
    const t=T[lang];
    const projectId=input.projectId?.trim()||"default";
    if(!text)return{ok:false,lang,intent:"error",reply:t.empty};

    const normalized=normalizeArabic(text);
    if(TIME_AR.test(normalized)||TIME_EN.test(text))return{ok:true,lang,intent:"time",reply:t.time(this.now())};
    const tokens=tokenize(text);
    const wordCount=normalized.split(/\s+/).filter(Boolean).length;
    const wantsReport=(REPORT_PHRASES.test(normalized)||tokens.some(w=>REPORT_WORDS.has(w)))&&wordCount<=6&&!tokens.some(w=>CREATE_WORDS.has(w));
    if(wantsReport){
      const report=this.report(projectId);
      return{ok:true,lang,intent:"report",reply:report.text[lang],report};
    }

    let decision:Record<string,unknown>|null=null;
    try{decision=extractObject(await this.deps.decide(this.prompt(text,lang,input.history??[])));}
    catch{return{ok:false,lang,intent:"error",reply:t.noModel};}

    const reply=clean(typeof decision?.reply==="string"?decision.reply:"",500);
    const goal=clean(typeof decision?.goal==="string"?decision.goal:"",1000);
    if(decision?.intent!=="task"||!goal)
      return{ok:true,lang,intent:"answer",reply:reply||(lang==="ar"?"حسناً.":"Okay.")};
    if(input.allowTasks===false)return{ok:true,lang,intent:"task",goal,reply:t.tasksOff(goal)};

    try{
      const result=await this.deps.runTask(goal,projectId);
      const completed=result.completed===true,paused=result.paused===true;
      const status=typeof result.status==="string"?result.status:undefined;
      const reason=clean(typeof result.reason==="string"?result.reason:typeof result.error==="string"?result.error:"",200);
      const missionId=typeof result.missionId==="string"?result.missionId:undefined;
      const spoken=completed?t.done(goal):paused?t.paused:t.failed(reason);
      return{ok:true,lang,intent:"task",goal,...(missionId?{missionId}:{}),task:{completed,paused,...(status?{status}:{}),...(reason?{reason}:{})},reply:spoken};
    }catch(error){
      return{ok:false,lang,intent:"task",goal,task:{completed:false,paused:false,reason:clean((error as Error).message,200)},reply:t.failed(clean((error as Error).message,200))};
    }
  }

  private prompt(text:string,lang:AssistantLang,history:AssistantHistoryItem[]):string{
    const recent=history.slice(-6).map(h=>`${h.role==="user"?"Owner":"LayanX"}: ${clean(h.text,300)}`).join("\n");
    return [
      "You are LayanX, a personal assistant like Jarvis that runs on the owner's own Windows computer.",
      "You can talk, and you can run real work through the LayanX agent: coding, files, git, browser, desktop, email, social media posts, ads, the online store and scheduling.",
      "Decide what to do with the owner's last message and answer with ONLY one JSON object:",
      '{"intent":"answer","reply":"..."} for conversation, questions, explanations and greetings, or',
      '{"intent":"task","goal":"...","reply":"..."} when the owner asks you to do, create, send, publish, change or check something on the computer or in their accounts.',
      `Rules: "reply" is spoken aloud, at most two short sentences, no lists or markdown, written in ${lang==="ar"?"Arabic":"English"}.`,
      '"goal" is a complete, self-contained instruction for the agent in the owner\'s language. Never say a task is done; the agent reports the result.',
      `Current time: ${this.now().toISOString()}`,
      recent?`Conversation so far:\n${recent}`:"",
      `Owner: ${text}`
    ].filter(Boolean).join("\n");
  }
}

/** Adapter from the real runtime core. */
export function coreAssistantDeps(core:LayanXCore):AssistantDeps{
  return{
    // latencySensitive: spoken replies go to the small "fast" model when one is installed.
    decide:async prompt=>(await core.modelExecution.execute({capability:"reasoning",input:prompt,maxOutputTokens:400,routing:{preferLocal:true,latencySensitive:true}})).output,
    runTask:async(goal,projectId)=>await core.runAgentGateway(goal,projectId,10) as unknown as Record<string,unknown>,
    snapshot:projectId=>{
      const missions=core.missions.list().map(m=>({id:m.id,goal:m.goal,status:m.status,createdAt:m.createdAt,...(m.projectId?{projectId:m.projectId}:{})}));
      const own=new Set(missions.filter(m=>!m.projectId||m.projectId===projectId).map(m=>m.id));
      const approvals=core.executionRuntime.approvals.list().filter(a=>own.has(a.missionId))
        .map(a=>({id:a.id,tool:a.tool,action:a.action,missionId:a.missionId,approved:core.executionRuntime.approvals.isApproved(a.id)}));
      return{missions,approvals,schedules:core.scheduler.list().length};
    }
  };
}

/**
 * Optional daily briefing (LAYANX_BRIEFING_TIME=HH:MM). The latest one is kept on
 * disk so the voice page can read it out when the owner opens it.
 */
export class DailyBriefing{
  private timer:NodeJS.Timeout|undefined;
  private readonly file:string;
  constructor(private readonly assistant:VoiceAssistant,private readonly options:{time:string;projectId?:string;file?:string;now?:()=>Date}){
    this.file=options.file??join(process.env.LAYANX_STORE_DIR?.trim()||".layanx","briefing.json");
  }
  latest():{date:string;generatedAt:string;report:AssistantReport}|null{
    try{return existsSync(this.file)?JSON.parse(readFileSync(this.file,"utf8")):null;}catch{return null;}
  }
  /** Generates today's briefing once the configured time has passed. Returns true when a new one was written. */
  tick():boolean{
    const match=/^(\d{1,2}):(\d{2})$/.exec(this.options.time.trim());
    if(!match)return false;
    const now=this.options.now?.()??new Date();
    const due=new Date(now);due.setHours(Number(match[1]),Number(match[2]),0,0);
    const date=now.toISOString().slice(0,10);
    if(now<due||this.latest()?.date===date)return false;
    const report=this.assistant.report(this.options.projectId??"default");
    mkdirSync(dirname(this.file),{recursive:true});
    writeFileSync(this.file,JSON.stringify({date,generatedAt:report.generatedAt,report},null,2),{mode:0o600});
    return true;
  }
  start(intervalMs=60_000){this.stop();this.tick();this.timer=setInterval(()=>this.tick(),intervalMs);this.timer.unref();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
}
