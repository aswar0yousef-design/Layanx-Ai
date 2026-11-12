import type {LayanXCore} from "../core/orchestrator.js";
import type {ChannelMessage,ChannelPolicy,ChannelRole} from "./types.js";
import {MONEY_REFUSAL,routeGoal} from "../autonomy/domain-coordinator.js";
import {routeRequest} from "../voice/request-router.js";
import {composeTaskAnswer} from "../core/task-answer.js";
import {OwnerFacts,factCommand,factReply,factsForPrompt} from "../memory/owner-facts.js";

/**
 * Messages from WhatsApp and Telegram. Found 2026-11-13: the owner's messages all went to the agent (a question too), a
 * finished task answered "تم تنفيذ الطلب بنجاح" instead of the answer (no order count, no prices), and anything that needed
 * an approval said to open the panel. Now:
 *  - a question gets a conversational answer, and nothing runs;
 *  - a task runs, and the reply is the same code-written answer the panel shows;
 *  - a step that needs approval is described exactly (the post's text, the change to the store) and the OWNER approves it
 *    by replying «موافق» within 15 minutes, or «لا». Staff and customers can never approve. Money stays out (routeGoal).
 */
interface PendingApproval{missionId:string;approvalId:string;nextToolIndex:number;goal:string;at:number}
const APPROVAL_TTL_MS=15*60_000;
const YES=/^\s*(?:موافق|اوافق|أوافق|نعم|ايوه|أيوه|اوكي|تمام|نفذ|نفّذ|انشر|yes|ok|okay|approve|go)\s*[.!]?\s*$/iu;
const NO=/^\s*(?:لا|ال[غع]|الغاء|إلغاء|توقف|no|cancel|stop)\s*[.!]?\s*$/iu;
const arabic=(t:string)=>/[؀-ۿ]/.test(t);

export class ChannelRouter{
 private readonly pending=new Map<string,PendingApproval>();
 constructor(private readonly core:LayanXCore,private readonly policy:ChannelPolicy,private readonly now:()=>number=()=>Date.now()){}
 roleFor(senderId:string):ChannelRole{
  if(this.policy.ownerIds.has(senderId))return"owner";
  if(this.policy.staffIds.has(senderId))return"staff";
  return"customer";
 }
 /** What the paused step will do, in the owner's words: the tool and what it carries (a post's full text, a store change). */
 private describe(missionId:string,index:number,A:boolean):string{
  const plan=this.core.missions.get(missionId)?.tools?.[index];
  if(!plan)return A?"خطوة تحتاج موافقتك.":"A step needs your approval.";
  const p=(plan.payload??{}) as Record<string,unknown>;
  const what=typeof p.text==="string"&&p.text?(A?"سأنشر هذا النص حرفياً"+(Array.isArray(p.platforms)&&p.platforms.length?" على "+p.platforms.join("، "):"")+":\n———\n"+p.text+"\n———":"I will publish exactly this text"+(Array.isArray(p.platforms)&&p.platforms.length?" on "+p.platforms.join(", "):"")+":\n———\n"+p.text+"\n———")
   :typeof p.goal==="string"&&p.goal?(A?`الخطوة: ${plan.tool}\nالطلب: ${p.goal}`:`Step: ${plan.tool}\nRequest: ${p.goal}`)
   :(A?`الخطوة: ${plan.tool} — ${plan.reason}`:`Step: ${plan.tool} — ${plan.reason}`);
  return what;
 }
 private async finish(result:any,goal:string,chatId:string,role:ChannelRole):Promise<string>{
  const A=arabic(goal);
  if(result?.paused&&result.approvalId){
   if(role!=="owner")return A?"هذه الخطوة تحتاج موافقة صاحب LayanX.":"This step needs the owner's approval.";
   this.pending.set(chatId,{missionId:result.missionId,approvalId:result.approvalId,nextToolIndex:result.nextToolIndex,goal,at:this.now()});
   return[A?"تحتاج هذه الخطوة موافقتك:":"This step needs your approval:",this.describe(result.missionId,result.nextToolIndex,A),
    A?"رد بـ «موافق» للتنفيذ أو «لا» للإلغاء (خلال 15 دقيقة).":"Reply \"yes\" to go ahead or \"no\" to cancel (within 15 minutes)."].join("\n");
  }
  const answer=result?.results?await composeTaskAnswer(this.core.modelExecution,goal,result.results,result.completed===true).catch(()=>null):null;
  if(answer?.text)return answer.text;
  if(result?.completed)return A?"تم.":"Done.";
  return(A?"تعذّر إكمال الطلب: ":"Could not finish: ")+String(result?.reason??result?.error??(A?"حدث خطأ.":"an error occurred."));
 }
 async handle(message:ChannelMessage):Promise<string>{
  const role=this.roleFor(message.senderId);
  const A=arabic(message.text);
  if(role==="customer"){
   const prompt=`You are LayanX customer support. Reply to the customer message below using available business knowledge and context. Do not claim actions, orders, refunds, bookings, or facts you cannot verify. Do not execute system, desktop, code, financial, or administrative actions. Be concise and helpful. Channel: ${message.channel}. Customer message: ${message.text}`;
   const result=await this.core.modelExecution.execute({capability:"chat",input:prompt,maxOutputTokens:700,routing:{preferLocal:true}});
   return result.output.trim()||"عذرًا، لم أتمكن من إعداد رد الآن.";
  }
  // The owner answering a pending approval.
  const waiting=this.pending.get(message.chatId);
  if(waiting&&(YES.test(message.text)||NO.test(message.text))){
   this.pending.delete(message.chatId);
   const WA=arabic(waiting.goal);
   if(role!=="owner")return WA?"فقط صاحب LayanX يوافق.":"Only the owner can approve.";
   if(this.now()-waiting.at>APPROVAL_TTL_MS)return WA?"انتهت مهلة الموافقة (15 دقيقة). أرسل الطلب من جديد.":"The approval expired (15 minutes). Send the request again.";
   if(NO.test(message.text)){
    // Revoked: that one step can never run on this approval; no other task is touched.
    try{this.core.executionRuntime.approvals.revoke(waiting.approvalId);}catch{}
    return WA?"ألغيتُ الخطوة، ولم يُنفَّذ شيء.":"Cancelled; nothing was done.";
   }
   this.core.executionRuntime.approvals.approve(waiting.approvalId);
   const resumed=await this.core.executeAgentLoop(waiting.missionId,"default",12,{[waiting.nextToolIndex]:waiting.approvalId},"core");
   return this.finish(resumed,waiting.goal,message.chatId,role);
  }
  // The owner's own facts: "remember that ..." is kept (only the owner's messages), and used in answers.
  const facts=OwnerFacts.at();
  const command=factCommand(message.text);
  if(command){if(role!=="owner")return A?"ما أتذكره عن صاحب LayanX يخصه وحده.":"What I remember about the owner is for the owner only.";return factReply(facts,command,A);}
  if(routeGoal(message.text).needsOwner)return A?MONEY_REFUSAL:"Moving, paying or withdrawing money is your decision, done by you outside LayanX. I will not do it, and no money was moved.";
  const route=routeRequest(message.text).route;
  if(route==="answer"){
   const result=await this.core.modelExecution.execute({capability:"chat",input:[`You are LayanX, the owner's assistant, answering on ${message.channel}. Answer briefly in the language of the message. Do not claim you did anything.`,role==="owner"?factsForPrompt(facts,message.text):"",`Message: ${message.text}`].filter(Boolean).join("\n"),maxOutputTokens:600,routing:{preferLocal:true}});
   return result.output.trim()||(A?"لم أستطع الرد الآن.":"I could not answer right now.");
  }
  if(route==="project-build"||route==="project-repair"||route==="project-status")
   return A?"بناء المشاريع وإصلاحها يُدار من لوحة LayanX أو المساعد الصوتي، حيث تُتابَع الفحوص والملفات.":"Building and repairing projects runs from the LayanX panel or the voice assistant, where checks and files can be followed.";
  const result=await this.core.runAgentGateway(message.text,"default",12,{},"core",{preferLocal:true});
  return this.finish(result,message.text,message.chatId,role);
 }
}
