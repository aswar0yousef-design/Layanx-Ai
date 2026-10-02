import type {LayanXCore} from "./orchestrator.js";
import type {MissionScheduler} from "./scheduler.js";

export interface RuntimeEvent{
 id:string;
 type:string;
 projectId:string;
 timestamp:string;
 actor?:string;
 payload?:Record<string,unknown>;
}
export interface EventMissionTrigger{
 id:string;
 eventType:string;
 projectId:string;
 goal:string;
 maxSteps?:number;
 agentId?:string;
 enabled:boolean;
 match?:Record<string,unknown>;
}

export class EventMissionEngine{
 private readonly triggers=new Map<string,EventMissionTrigger>();
 private readonly active=new Set<string>();
 constructor(private readonly core:LayanXCore,private readonly scheduler?:MissionScheduler){}
 register(input:Omit<EventMissionTrigger,"id"|"enabled">&{enabled?:boolean}){
  if(!input.eventType.trim())throw new Error("Event type is required.");
  if(!input.goal.trim())throw new Error("Event mission goal is empty.");
  const trigger={...input,id:crypto.randomUUID(),enabled:input.enabled??true,projectId:this.core.projectIsolation.normalize(input.projectId)};
  this.triggers.set(trigger.id,trigger);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:"event-engine",action:"event.trigger.create",resource:trigger.id,result:"success",metadata:{projectId:trigger.projectId,eventType:trigger.eventType}});
  return structuredClone(trigger);
 }
 remove(id:string){if(!this.triggers.delete(id))throw new Error("Unknown event trigger.");}
 setEnabled(id:string,enabled:boolean){const trigger=this.require(id);trigger.enabled=enabled;return structuredClone(trigger);}
 list(){return [...this.triggers.values()].map(structuredClone);}
 async emit(event:RuntimeEvent){
  const matches=[...this.triggers.values()].filter(trigger=>trigger.enabled&&!this.active.has(trigger.id)&&trigger.eventType===event.type&&trigger.projectId===event.projectId&&this.matches(trigger.match,event.payload));
  return Promise.all(matches.map(trigger=>this.fire(trigger,event)));
 }
 private async fire(trigger:EventMissionTrigger,event:RuntimeEvent){
  this.active.add(trigger.id);
  try{
   const goal=[trigger.goal,"Triggered by event: "+event.type,"Event payload (untrusted): "+JSON.stringify(event.payload??{}).slice(0,8000)].join("\n");
   const result=await this.core.runAgentGateway(goal,trigger.projectId,trigger.maxSteps??10,{},trigger.agentId??"core");
   this.core.audit.append({timestamp:new Date().toISOString(),actor:"event-engine",action:"event.mission.run",resource:trigger.id,result:result.completed?"success":"failure",metadata:{triggerId:trigger.id,eventId:event.id,eventType:event.type,missionId:result.missionId,projectId:event.projectId}});
   return result;
  }finally{this.active.delete(trigger.id);}
 }
 private require(id:string){const trigger=this.triggers.get(id);if(!trigger)throw new Error("Unknown event trigger.");return trigger;}
 private matches(match:Record<string,unknown>|undefined,payload:Record<string,unknown>|undefined){
  if(!match)return true;const source=payload??{};
  return Object.entries(match).every(([key,value])=>JSON.stringify(source[key])===JSON.stringify(value));
 }
}