import type {LayanXCore} from "../core/orchestrator.js";
import type {ChannelMessage,ChannelPolicy,ChannelRole} from "./types.js";

export class ChannelRouter{
 constructor(private readonly core:LayanXCore,private readonly policy:ChannelPolicy){}
 roleFor(senderId:string):ChannelRole{
  if(this.policy.ownerIds.has(senderId))return"owner";
  if(this.policy.staffIds.has(senderId))return"staff";
  return"customer";
 }
 async handle(message:ChannelMessage):Promise<string>{
  const role=this.roleFor(message.senderId);
  const prompt=role==="customer"
   ? `You are LayanX customer support. Reply to the customer message below using available business knowledge and context. Do not claim actions, orders, refunds, bookings, or facts you cannot verify. Do not execute system, desktop, code, financial, or administrative actions. Be concise and helpful. Channel: ${message.channel}. Customer message: ${message.text}`
   : `You are LayanX operating through a trusted ${role} messaging channel. Execute the user's instruction using the normal LayanX agent and tools. Report only verified results. User message: ${message.text}`;
  if(role==="customer"){
   const result=await this.core.modelExecution.execute({capability:"chat",input:prompt,maxOutputTokens:700,routing:{preferLocal:true}});
   return result.output.trim()||"عذرًا، لم أتمكن من إعداد رد الآن.";
  }
  const result=await this.core.runAgentGateway(message.text,"default",12,{}, "core",{preferLocal:true});
  if(result.paused)return"توقفت العملية مؤقتًا وتحتاج إلى موافقة من لوحة LayanX.";
  if(result.completed){
   const last=[...(result.results??[])].reverse().find(item=>item&&typeof item==="object"&&"data" in item) as {data?:unknown}|undefined;
   if(typeof last?.data==="string")return last.data;
   return"تم تنفيذ الطلب بنجاح.";
  }
  return`تعذر إكمال الطلب: ${String(result.reason??"حدث خطأ أثناء التنفيذ.")}`;
 }
}
