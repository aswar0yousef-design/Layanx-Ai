export interface AuditEvent{timestamp:string;actor:string;action:string;resource:string;result:"allowed"|"denied"|"pending_approval"|"skipped"|"success"|"failure";metadata?:Record<string,unknown>;}

const sensitiveKey=/api[_ -]?key|secret|password|token|authorization|private[_ -]?key|credential/i;
const bearer=/bearer\s+[A-Za-z0-9._-]{8,}/gi;
function sanitize(value:unknown):unknown{
 if(typeof value==="string")return value.replace(bearer,"[REDACTED]");
 if(Array.isArray(value))return value.map(sanitize);
 if(value&&typeof value==="object"){
  const output:Record<string,unknown>={};
  for(const [key,item] of Object.entries(value))output[key]=sensitiveKey.test(key)?"[REDACTED]":sanitize(item);
  return output;
 }
 return value;
}
function safeEvent(event:AuditEvent):AuditEvent{return structuredClone({...event,metadata:event.metadata?sanitize(event.metadata) as Record<string,unknown>:undefined});}

export class AuditLog{
 private readonly events:AuditEvent[]=[];
 private readonly lastByMission=new Map<string,number>();
 append(event:AuditEvent){this.events.push(safeEvent(event));const missionId=event.metadata?.missionId;if(typeof missionId==="string")this.lastByMission.set(missionId,Date.now());}
 /** When the mission last recorded anything in this run (ms), 0 if never. */
 lastActivity(missionId:string){return this.lastByMission.get(missionId)??0;}
 list(){return this.events.map(safeEvent);}
 forResource(resource:string){return this.events.filter(e=>e.resource===resource).map(safeEvent);}
 forMission(missionId:string){return this.events.filter(e=>e.metadata?.missionId===missionId).map(safeEvent);}
 restore(events:AuditEvent[]){this.events.push(...events.map(safeEvent));}
}