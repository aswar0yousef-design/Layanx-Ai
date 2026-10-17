import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DailyBriefing,VoiceAssistant,detectLang,type AssistantDeps} from "../src/voice/assistant.js";

const now=new Date("2026-10-06T09:30:00Z");
const prompts:string[]=[];
let decision='{"intent":"answer","reply":"أهلاً، كيف أساعدك؟"}';
let taskResult:Record<string,unknown>={completed:true,missionId:"m-1",status:"completed"};
const tasks:Array<{goal:string;projectId:string}>=[];
const deps:AssistantDeps={
  now:()=>now,
  decide:async p=>{prompts.push(p);if(decision==="THROW")throw new Error("no model");return decision;},
  runTask:async(goal,projectId)=>{tasks.push({goal,projectId});return taskResult;},
  snapshot:()=>({
    missions:[
      {id:"a",goal:"publish post",status:"completed",createdAt:"2026-10-06T08:00:00Z",projectId:"default"},
      {id:"b",goal:"fix failing tests",status:"failed",createdAt:"2026-10-06T07:00:00Z",projectId:"default"},
      {id:"c",goal:"old",status:"completed",createdAt:"2026-10-01T07:00:00Z",projectId:"default"},
      {id:"d",goal:"other project",status:"running",createdAt:"2026-10-06T07:00:00Z",projectId:"shop"}
    ],
    approvals:[{id:"ap1",tool:"terminal.exec",action:"run",missionId:"a",approved:false}],
    schedules:2
  })
};
const jarvis=new VoiceAssistant(deps);

assert.equal(detectLang("افتح المتصفح"),"ar");
assert.equal(detectLang("open the browser"),"en");

// time is answered locally, no model call
const t=await jarvis.turn({text:"كم الساعة الآن؟"});
assert.equal(t.intent,"time");assert.equal(t.lang,"ar");assert.equal(prompts.length,0);
assert.equal((await jarvis.turn({text:"what time is it"})).intent,"time");

// report: deterministic, counts only the last 24h of this project
const r=await jarvis.turn({text:"أعطني تقرير اليوم"});
assert.equal(r.intent,"report");
assert.deepEqual(r.report?.counts,{total:2,completed:1,failed:1,active:0,blocked:0,cancelled:0});
assert.equal(r.report?.pendingApprovals,1);
assert.match(r.reply,/موافقة تنتظرك/);
const en=await jarvis.turn({text:"give me a status report"});
assert.equal(en.intent,"report");assert.match(en.reply,/approval is waiting/);
assert.equal(prompts.length,0,"reports never need the model");

// a task that mentions "report" still goes to the model
decision='<think>hmm</think>```json\n{"intent":"task","goal":"اكتب تقرير المبيعات وأرسله بالبريد","reply":"سأبدأ"}\n```';
const salesReport=await jarvis.turn({text:"اكتب تقرير المبيعات وأرسله لي بالبريد"});
assert.equal(salesReport.intent,"task");
assert.equal(tasks.at(-1)?.goal,"اكتب تقرير المبيعات وأرسله بالبريد");
assert.match(salesReport.reply,/^تم/);
assert.equal(salesReport.missionId,"m-1");
assert.match(prompts.at(-1)!,/written in Arabic/);

// conversation answer in English, history is passed to the model
decision='{"intent":"answer","reply":"Sure, I am here."}';
const answer=await jarvis.turn({text:"are you there?",history:[{role:"user",text:"hello"},{role:"assistant",text:"hi"}]});
assert.equal(answer.intent,"answer");assert.equal(answer.reply,"Sure, I am here.");
assert.match(prompts.at(-1)!,/Owner: hello\nLayanX: hi\nOwner: are you there\?/);

// paused / failed / disabled tasks
decision='{"intent":"task","goal":"push the release branch","reply":"ok"}';
taskResult={paused:true,missionId:"m-2"};
assert.match((await jarvis.turn({text:"push the release branch"})).reply,/needs your approval/);
taskResult={completed:false,reason:"Tool terminal.exec is not allowed."};
assert.match((await jarvis.turn({text:"push the release branch"})).reply,/couldn't finish the task\. Tool terminal\.exec/);
const before=tasks.length;
const off=await jarvis.turn({text:"push the release branch",allowTasks:false});
assert.equal(off.intent,"task");assert.equal(tasks.length,before,"no task runs when tasks are off");

// model unavailable -> actionable message, never a crash
decision="THROW";
const down=await jarvis.turn({text:"افتح الملف"});
assert.equal(down.ok,false);assert.match(down.reply,/Ollama/);
decision="not json";
assert.equal((await jarvis.turn({text:"hello"})).intent,"answer");
assert.equal((await jarvis.turn({text:"   "})).ok,false);

// daily briefing: once per day after the configured time
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-brief-"));
let clock=new Date(2026,9,6,7,59);
const brief=new DailyBriefing(jarvis,{time:"08:00",file:path.join(dir,"briefing.json"),now:()=>clock});
assert.equal(brief.tick(),false,"not yet due");
clock=new Date(2026,9,6,8,1);
assert.equal(brief.tick(),true);
assert.equal(brief.tick(),false,"only once per day");
assert.equal(brief.latest()?.report.counts.total,2);

// Greetings are answered at once, without the model (the owner's "Layan, how are you?" waited minutes
// behind a website job): only when the whole sentence is a greeting.
{
  const before=prompts.length;
  const cases:Array<[string,RegExp]>=[["كيف الحال؟",/بخير/],["ليان، كيف حالك؟",/بخير/],["السلام عليكم ورحمة الله",/وعليكم السلام/],["مرحباً",/أهلاً/],
    ["يا ليان صباح الخير",/صباح النور/],["شكراً جزيلاً",/العفو/],["مرحبا كيف حالك",/بخير/],["Hey, how are you?",/I'm well/],["thank you",/welcome/i]];
  for(const [text,re] of cases){const r=await jarvis.turn({text});assert.equal(r.intent,"answer",text);assert.match(r.reply,re,text);}
  assert.equal(prompts.length,before,"no model call for a greeting");
  for(const text of ["كيف حال الطقس اليوم في مسقط؟","مرحبا افتح المتصفح","hello, write a post about our sale","شكرا ارسل الفاتورة"]){
    await jarvis.turn({text});
  }
  assert.equal(prompts.length,before+4,"a greeting with a request still goes to the model");
}

// A model that does not answer in time (busy with a job): LayanX says why, instead of thinking forever.
{
  process.env.LAYANX_ASSISTANT_TIMEOUT_MS="150";
  const slow=new VoiceAssistant({...deps,decide:()=>new Promise<string>(()=>{}),busyWith:()=>"اريد منك عمل موقع احترافي لمحل بيع كمبيوترات"});
  const started=Date.now();const r=await slow.turn({text:"ما أفضل لغة برمجة للمواقع؟"});
  assert.ok(Date.now()-started<2000);assert.equal(r.intent,"busy");assert.equal(r.ok,true);
  assert.match(r.reply,/مشغول الآن بمهمة «اريد منك عمل موقع احترافي/);
  const idle=await new VoiceAssistant({...deps,decide:()=>new Promise<string>(()=>{})}).turn({text:"explain recursion"});
  assert.match(idle.reply,/Ollama/);
  delete process.env.LAYANX_ASSISTANT_TIMEOUT_MS;
}

console.log("assistant: all assertions passed");
