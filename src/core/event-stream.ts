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
 if(a.includes("approval")||(/approval|required/i.test(String(event.metadata?.reason??""))&&event.result==="denied"))return "approval.required";
 if(a.includes("verify")&&event.result==="success")return "verification.completed";
 if(a.includes("verify"))return "verification.started";
 if(event.result==="failure")return a.includes("replan")?"replanning.started":"tool.failed";
 if(event.result==="denied")return "mission.blocked";
 if(a.includes("cancel"))return "mission.cancelled";
 if(a.includes("complete"))return "mission.completed";
 if(a.includes("replan"))return "replanning.completed";
 return event.result==="success"?"tool.completed":"runtime.event";
}

function toEvent(event:AuditEvent,projectIds:Record<string,string>,repeat:Map<string,number>):MissionEvent|null{
 const metadata=event.metadata??{};
 const missionId=typeof metadata.missionId==="string"?metadata.missionId:"";
 const projectId=typeof metadata.projectId==="string"?metadata.projectId:projectIds[missionId]??"";
 if(!missionId||!projectId)return null;
 // The id depends on the event itself, not on its position in whichever audit list was synced
 // (the full log and a per-mission list must give the same event the same id).
 const content=JSON.stringify([missionId,event.timestamp,event.actor,event.action,event.result,event.resource??null,metadata.planIndex??null,metadata.reason??metadata.error??null]);
 // Two genuinely separate events with the same content: the second, third... get their own id. Every list
 // (the full log or one mission's) holds a mission's events in the same order, so the count agrees.
 const nth=repeat.get(content)??0;repeat.set(content,nth+1);
 const id=createHash("sha256").update(nth?content+"#"+nth:content).digest("hex").slice(0,24);
 const tool=typeof event.resource==="string"&&!event.resource.startsWith("mission")?event.resource:undefined;
 const message=typeof metadata.reason==="string"?metadata.reason:typeof metadata.error==="string"?metadata.error:undefined;
 const stepIndex=typeof metadata.planIndex==="number"?metadata.planIndex:undefined;
 return {id,missionId,projectId,timestamp:event.timestamp,type:typeFor(event),actor:event.actor,tool,action:event.action,stepIndex,message};
}

export class MissionEventStream{
 private readonly events=new Map<string,MissionEvent[]>();
 private readonly maxPerMission=200;
 /** Arrival order across all missions (ids are hashes): lets `after` work on the combined list too. */
 private readonly order=new Map<string,number>();
 private seq=0;

 sync(audit:AuditEvent[],projectIds:Record<string,string>={}):void{
  const repeat=new Map<string,number>();
  audit.forEach(event=>{
   const mapped=toEvent(event,projectIds,repeat);
   if(!mapped)return;
   const list=this.events.get(mapped.missionId)??[];
   if(list.some(item=>item.id===mapped.id))return;
   list.push(mapped);
   this.order.set(mapped.id,++this.seq);
   if(list.length>this.maxPerMission)list.splice(0,list.length-this.maxPerMission);
   // Positions of evicted events are kept for a while, so a client holding one still gets only newer events.
   if(this.order.size>20_000)for(const key of [...this.order.keys()].slice(0,this.order.size-20_000))this.order.delete(key);
   this.events.set(mapped.missionId,list);
  });
 }

 /**
  * Events in arrival order; `after` is the id of the last event the caller has seen (ids are hashes, not
  * ordered). An id this stream never saw returns everything it has (clients drop ids they already have).
  */
 list(projectId:string,missionId?:string,after?:string):MissionEvent[]{
  const pos=(event:MissionEvent)=>this.order.get(event.id)??0;
  let source=(missionId?(this.events.get(missionId)??[]):[...this.events.values()].flat()).slice().sort((a,b)=>pos(a)-pos(b));
  const from=after?this.order.get(after):undefined;
  if(from!==undefined)source=source.filter(event=>pos(event)>from);
  return source.filter(event=>event.projectId===projectId).map(event=>structuredClone(event));
 }
}
