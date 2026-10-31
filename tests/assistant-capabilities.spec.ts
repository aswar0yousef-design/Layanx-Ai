import assert from "node:assert/strict";
import {VoiceAssistant,capabilityQuestion,type AssistantDeps} from "../src/voice/assistant.js";

const yes=[
 "ما الذي يمكنك فعله؟","مالذي يمكنك فعله","ما الذي يمكنك فعله لي",
 "ما الذي يمكنك عمله؟","مالذي يمكنك عمله","مالذي يمكنك عمله لي","ماذا يمكنك عمله؟",
 "ماذا يمكنك فعله؟","ماذا يمكنك فعله لي","ماذا تستطيع أن تفعل",
 "يا ليان ماذا يمكنك فعله؟","ما هي إمكانياتك","ماهي قدراتك","كيف تساعدني",
 "وش تقدر تسوي","what can you do?","what can you do for me?",
 "how can you help me","what are your capabilities"
];
const no=[
 "ما الذي يمكنك فعله في ملف المشروع؟","مالذي يمكنك عمله في ملف المشروع؟","ماذا تستطيع أن تفعل بخصوص تداول الذهب؟",
 "ماذا يمكنك فعله لتحسين متجري","كيف تساعدني في كتابة مشروع React",
 "What can you do with this CSV file?","مرحبا افتح المتصفح",
 "نفذ اختبارات المشروع","ما حالة المشروعات؟"
];
for(const question of yes)assert.equal(capabilityQuestion(question),true,question);
for(const question of no)assert.equal(capabilityQuestion(question),false,question);

let modelCalls=0,toolCalls=0;
const deps:AssistantDeps={
 decide:async()=>{modelCalls++;return JSON.stringify({intent:"answer",reply:"Generic, unhelpful answer."});},
 runTask:async()=>{toolCalls++;return{completed:true};},
 snapshot:()=>({missions:[],approvals:[],schedules:0})
};
const assistant=new VoiceAssistant(deps);
for(const question of yes){
 const answer=await assistant.turn({text:question,allowTasks:true});
 assert.equal(answer.intent,"answer",question);
 assert.equal(answer.ok,true);
 assert.match(answer.reply,/البرمجة|coding|project files|المشاريع|Windows|ويندوز/i,question);
 assert.doesNotMatch(answer.reply,/Generic, unhelpful answer/);
 assert.equal(answer.missionId,undefined);
}
assert.equal(modelCalls,0,"Capabilities should work even if the local model is overloaded");
assert.equal(toolCalls,0,"Questions must not trigger actions");
const disabled=await assistant.turn({text:"ما الذي يمكنك فعله لي؟",allowTasks:false});
assert.equal(disabled.intent,"answer");
assert.match(disabled.reply,/عند تفعيل تنفيذ المهام/);
assert.equal(modelCalls,0);assert.equal(toolCalls,0);
const focused=await assistant.turn({text:"What can you do with this CSV file?",allowTasks:false});
assert.equal(focused.reply,"Generic, unhelpful answer.","A specific file question should reach the model");
assert.equal(modelCalls,1);
const arabicFocused=await assistant.turn({text:"ماذا يمكنك فعله لتحسين متجري",allowTasks:false});
assert.equal(arabicFocused.reply,"Generic, unhelpful answer.");
assert.equal(modelCalls,2);
assert.equal(toolCalls,0);
console.log("assistant capabilities: Arabic/English variants answer directly, task execution remains gated, scoped questions still use the model");
