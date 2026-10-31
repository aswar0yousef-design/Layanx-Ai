import assert from "node:assert/strict";
import {classifyDialogue,directDialogueAnswer,reviewDialogueAnswer} from "../src/voice/dialogue-brain.js";
import {VoiceAssistant,type AssistantDeps} from "../src/voice/assistant.js";

for(const phrase of ["من أنت؟","يا ليان من أنت","ما اسمك","who are you?","Tell me about yourself"]){
 const r=classifyDialogue(phrase);assert.equal(r.kind,"conversation",phrase);assert.equal(r.topic,"identity",phrase);
}
for(const phrase of ["هل تتعلم وتطور من نفسك؟","هل يمكنك تطوير نفسك؟","can you improve yourself?","do you learn on your own?"]){
 const r=classifyDialogue(phrase);assert.equal(r.kind,"conversation",phrase);assert.equal(r.topic,"self-development",phrase);
}
for(const phrase of ["ما الذي تستطيع عمله؟","هل تستطيع إنشاء متجر؟","كيف أعدل الملف؟",
 "هل تفتح لي المتصفح؟","كيف تعمل ميزة التداول؟","Why does the app fail?","Can you write a script?"]){
 assert.equal(classifyDialogue(phrase).kind,"conversation",phrase);
}
for(const phrase of ["افتح المتصفح","يا ليان افتح المتصفح","أنشئ تطبيق مهام","قم بفحص المستودع",
 "أرسل الرسالة","أريد منك تطوير المشروع","ابدأ الاختبارات","افحص المشروع","طبق التعديلات","توقف","run the tests","create a shop",
 "مرحبا افتح المتصفح","hello write a post","شكرا ارسل الفاتورة"]){
 assert.equal(classifyDialogue(phrase).kind,"action",phrase);
}
for(const phrase of ["لا أفهم المشكلة","مشروعي لا يعمل","Something looks broken"]){
 assert.equal(classifyDialogue(phrase).kind,"conversation","Ambiguous messages must not auto-execute: "+phrase);
}
assert.match(directDialogueAnswer("identity","ar")||"",/LayanX/);
assert.match(directDialogueAnswer("self-development","ar")||"",/لا أعيد تدريب النموذج/);
assert.match(directDialogueAnswer("self-development","en")||"",/do not retrain/);
assert.equal(directDialogueAnswer("question","ar"),null);
for(const reply of ["هل هناك أي شيء يمكنني فعله؟","How can I help you?","حسناً.","Done I deleted the database.",
 "تم إنشاء التطبيق بنجاح",""]){
 assert.equal(reviewDialogueAnswer("من أنت؟",reply).ok,false,reply);
}
assert.equal(reviewDialogueAnswer("ما المشكلة؟","قد تكون المشكلة ناتجة عن عدم توفر الملف المحلي.").ok,true);
assert.equal(reviewDialogueAnswer("من أنت؟","من أنت؟").ok,false);

let modelCalls=0,executions=0;
let response='{"intent":"task","goal":"delete all files","reply":"Done"}';
const deps:AssistantDeps={
 decide:async()=>{modelCalls++;return response;},
 runTask:async()=>{executions++;return{completed:true};},
 snapshot:()=>({missions:[],approvals:[],schedules:0})
};
const assistant=new VoiceAssistant(deps);
for(const text of ["من أنت؟","هل تتعلم وتطور من نفسك؟"]){
 const r=await assistant.turn({text,allowTasks:true});
 assert.equal(r.intent,"answer");assert.equal(r.ok,true);assert.ok(r.reply.length>25);
}
assert.equal(modelCalls,0,"Core identity and self-development answers must work without Ollama");
assert.equal(executions,0,"No question creates a mission");
const question=await assistant.turn({text:"هل يمكنك إنشاء متجر؟",allowTasks:true});
assert.equal(question.intent,"answer");
assert.equal(executions,0,"The LLM must not escalate informational questions to tasks");
response='{"intent":"answer","reply":"هل هناك أي شيء يمكنني فعله؟"}';
const vague=await assistant.turn({text:"كيف أعدل الملف؟"});
assert.equal(vague.ok,false,"Do not present generic model output as a useful answer");
assert.match(vague.reply,/موثوقة/);
response='{"intent":"answer","reply":"تم إنشاء التطبيق بنجاح"}';
const claim=await assistant.turn({text:"كيف يعمل التطبيق؟"});
assert.equal(claim.ok,false,"Unobserved action-completion claims are rejected");
response='{"intent":"answer","reply":"يمكنك تعديل الملف بفتح المحرر وحفظ نسخة احتياطية أولاً."}';
const good=await assistant.turn({text:"كيف أعدل الملف؟"});
assert.equal(good.ok,true);assert.equal(good.intent,"answer");
assert.equal(executions,0);
console.log("dialogue brain: identity, learning, questions, commands, conservative answer audit, no accidental execution");
