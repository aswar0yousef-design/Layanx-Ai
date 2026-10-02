import {createHash} from "node:crypto";
import type {AuditEvent} from "./audit.js";

export type MissionEventType =
 | "mission.created" | "planning.started" | "planning.completed" | "tool.selected"
 | "approval.required" | "tool.started" | "tool.completed" | "tool.failed"
 | "replanning.started" | "replanning.completed" | "verification.started"
 | "verification.completed" | "mission.paused" | "mission.completed" | "mission.failed"
 | "mission.blocked" | "mission.cancelled" | "runtime.event";

export interface MissionEvent{
 id:string; missionId:string; projectId:string; timestamp:string; type:MissionEventType; actor:string;
 tool?:string; action?:string; stepIndex?:number; message?:string;
}

function typeFor(event:AuditEvent):MissionEventType{
 const a=event.action.toLowerCase();
 if(a==="mission.create"||a==="mission.created")return "mission.created";
 if(a.includes("plan")&&event.result==="allowed")return "planning.started";
 if(a.includes("plan")&&event.result==="success")return "planning.completed";
 if(a.includes("approval"))return "approval.required";
 if(a.includes("verify")&&event.result==="success")return "verification.completed";
 if(a.includes("verify"))return "verification.started";
 if(event.result==="failure")return a.includes("replan")?"replanning.started":"tool.failed";
 if(event.result==="denied")return "mission.blocked";
 if(a.includes("cancel"))return "mission.cancelled";
 if(a.includes("complete"))return "mission.completed";
 if(a.includes("replan"))return "replanning.completed";
 return event.result==="success"?"tool.completed":"runtime.event";
}

function toEvent(event:AuditEvent,index:number,projectIds:Record<string,string>):MissionEvent|null{
 const metadata=event.metadata??{};
 const missionId=typeof metadata.missionId==="string"?metadata.missionId:"";
 const projectId=typeof metadata.projectId==="string"?metadata.projectId:projectIds[missionId]??"";
 if(!missionId||!projectId)return null;
 const id=createHash("sha256").update(JSON.stringify([missionId,index,event.timestamp,event.actor,event.action,event.result])).digest("hex").slice(0,24);
 const tool=typeof event.resource==="string"&&!event.resource.startsWith("mission")?event.resource:undefined;
 const message=typeof metadata.reason==="string"?metadata.reason:typeof metadata.error==="string"?metadata.error:undefined;
 const stepIndex=typeof metadata.planIndex==="number"?metadata.planIndex:undefined;
 return {id,missionId,projectId,timestamp:event.timestamp,type:typeFor(event),actor:event.actor,tool,action:event.action,stepIndex,message};
}

export class MissionEventStream{
 private readonly events=new Map<string,MissionEvent[]>();
 private readonly maxPerMission=200;

 sync(audit:AuditEvent[],projectIds:Record<string,string>={}):void{
  audit.forEach((event,index)=>{
   const mapped=toEvent(event,index,projectIds);
   if(!mapped)return;
   const list=this.events.get(mapped.missionId)??[];
   if(list.some(item=>item.id===mapped.id))return;
   list.push(mapped);
   if(list.length>this.maxPerMission)list.splice(0,list.length-this.maxPerMission);
   this.events.set(mapped.missionId,list);
  });
 }

 list(projectId:string,missionId?:string,after?:string):MissionEvent[]{
  const source=missionId?(this.events.get(missionId)??[]):[...this.events.values()].flat();
  return source.filter(event=>event.projectId===projectId&&(!after||event.id>after)).map(event=>structuredClone(event));
 }
}
