import {JsonStateStore} from "./persistence.js";
import type {AuditEvent} from "./audit.js";

export class PersistentAuditLog{
  constructor(private readonly store:JsonStateStore<AuditEvent[]>){}
  async append(event:AuditEvent):Promise<void>{
    const current=await this.store.load()??[];
    current.push({...event});
    await this.store.save(current);
  }
  async list():Promise<AuditEvent[]>{return (await this.store.load())??[];}
  async forResource(resource:string):Promise<AuditEvent[]>{return (await this.list()).filter(e=>e.resource===resource);}
}
