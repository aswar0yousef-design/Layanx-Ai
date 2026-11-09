import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {asksProjectStatus,classifyProjectWork,isTaskListApp,projectStatusReply} from "../src/voice/project-intent.js";
import {VoiceAssistant} from "../src/voice/assistant.js";
import {chatProjects} from "../src/autonomy/chat-projects.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-chat-projects-"));
const env={...process.env,LAYANX_WORKSPACE_ROOT:root};

for(const text of ["ابن لي تطبيق قائمة مهام","ابنِ مشروع متجر","قم ببناء موقع لعيادتي","أريدك أن تبني تطبيق حجوزات","يا ليان اصنع لعبة بسيطة","build a task list app","Create a website for my shop","make an app"])assert.equal(classifyProjectWork(text),"build",text);
for(const text of ["أصلح المشروع","اصلح عطل الصفحة الرئيسية في mawid","قم بإصلاح التطبيق","fix the bug in my site","repair the app"])assert.equal(classifyProjectWork(text),"repair",text);
for(const text of ["هل يمكنك بناء موقع؟","كيف أبني تطبيق؟","افتح موقع يوتيوب","انشر منشور على فيسبوك","اكتب رسالة","ابن جملة مفيدة","اصلح الطابعة","what is an app","can you build a website","افتح التطبيق"])assert.equal(classifyProjectWork(text),null,text);
for(const text of ["وين وصل المشروع؟","ما حالة المشروع","project status","ماذا حدث في المشروع"])assert.ok(asksProjectStatus(text),text);
assert.equal(asksProjectStatus("ما حالة الطقس"),false);
assert.ok(isTaskListApp("ابن تطبيق قائمة مهام"));assert.ok(isTaskListApp("build a todo app"));assert.equal(isTaskListApp("ابن متجراً"),false);

// Replies come from the recorded state, and a failed job never sounds finished.
const view={id:"1",projectId:"site",goal:"g",stepNumber:2,totalSteps:3,step:"Server",handoffs:1,verified:false};
assert.match(projectStatusReply({...view,status:"running"},"ar"),/الخطوة 2 من 3: Server/);
assert.match(projectStatusReply({...view,status:"failed",result:"boom"},"ar"),/لم يكتمل[\s\S]*boom[\s\S]*HANDOFF\.md/);
assert.match(projectStatusReply({...view,status:"completed",verified:true},"ar"),/نجحت فحوصه/);
assert.match(projectStatusReply({...view,status:"completed"},"ar"),/دون إثبات كامل/,"completed without verification is not called success");
assert.match(projectStatusReply(undefined,"en"),/No project/);

const created:Array<{goal:string;projectId:string;opts:any}>=[];
const jobs:any[]=[];
const supervisor:any={create:(goal:string,projectId:string,opts:any)=>{created.push({goal,projectId,opts});const job={id:String(jobs.length),goal,projectId,status:"planning",milestones:[],current:0};jobs.unshift(job);return job;},list:()=>jobs};
const projects=chatProjects(supervisor,env as NodeJS.ProcessEnv);
const first=projects.startProject("ابن تطبيق قائمة مهام","build","default") as any;
assert.match(first.started.projectId,/^chat-project-[0-9a-f]{6}$/,"a new project never lands in the default folder");
assert.equal(created[0]!.opts.acceptanceProfile,"task-app-http-v1");
assert.equal((projects.startProject("ابن تطبيق قائمة مهام","build","default") as any).alreadyRunning,true,"the same request does not start twice");
assert.equal(created.length,1);
assert.deepEqual(projects.startProject("اصلح المشروع","repair","default"),{needsProject:true},"no guessing which folder to change");
fs.mkdirSync(path.join(root,"clinic"));fs.writeFileSync(path.join(root,"clinic","index.html"),"<p>x</p>");fs.mkdirSync(path.join(root,"node-app"));fs.writeFileSync(path.join(root,"node-app","package.json"),"{}");
const named=projects.startProject("fix the bug in clinic","repair","default") as any;
assert.equal(named.started.projectId,"clinic");assert.equal(created.at(-1)!.opts.acceptanceProfile,"static-repair-v1");
projects.startProject("fix the error in node-app","repair","default");
assert.equal(created.at(-1)!.opts.acceptanceProfile,undefined,"the static repair path is only for static projects");

// Through the assistant: the model and the plain task runner are not involved, and tasks-off is respected.
const ran:string[]=[];let decided=0;
const assistant=new VoiceAssistant({decide:async()=>{decided++;return'{"intent":"answer","reply":"model reply text"}';},runTask:async(goal:string)=>{ran.push(goal);return{completed:true};},snapshot:()=>({missions:[],approvals:[],schedules:0}),...projects} as any);
const started=await assistant.turn({text:"ابن موقع لعيادتي",projectId:"default"});
assert.equal(started.intent,"task");assert.ok(started.job?.id);assert.match(started.reply,/بدأت العمل/);
assert.deepEqual(ran,[]);assert.equal(decided,0);
const before=created.length;
const off=await assistant.turn({text:"ابن موقع لمطعمي",projectId:"default",allowTasks:false});
assert.equal(off.job,undefined);assert.equal(created.length,before,"nothing starts when tasks are off");
const missing=await assistant.turn({text:"اصلح المشروع",projectId:"default"});
assert.equal(missing.job,undefined);assert.match(missing.reply,/أي مشروع/);
const status=await assistant.turn({text:"وين وصل المشروع؟",projectId:"default"});
assert.equal(status.intent,"report");assert.match(status.reply,/قيد العمل/);assert.equal(decided,0);
const question=await assistant.turn({text:"هل يمكنك بناء موقع؟",projectId:"default"});
assert.equal(question.job,undefined,"a question starts nothing");
console.log("chat-projects: build and repair commands reach the supervisor; questions and unknown projects do not");
process.exit(0);
