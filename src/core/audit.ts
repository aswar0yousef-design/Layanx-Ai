export interface AuditEvent{timestamp:string;actor:string;action:string;resource:string;result:"allowed"|"denied"|"success"|"failure";metadata?:Record<string,unknown>;}
export class AuditLog{
 private readonly events:AuditEvent[]=[];
 append(event:AuditEvent){this.events.push({...event});}
 list(){return[...this.events];}
 forResource(resource:string){return this.events.filter(e=>e.resource===resource);}
}
