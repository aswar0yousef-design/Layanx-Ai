import {JsonStateStore} from "./persistence.js";
import type {LedgerEntry} from "./ledger.js";
export class PersistentLedger{
 constructor(private readonly store:JsonStateStore<LedgerEntry[]>){}
 async append(entry:LedgerEntry){const current=await this.store.load()??[];current.push(entry);await this.store.save(current);}
 async all(){return(await this.store.load())??[];}
 async forMission(missionId:string){return(await this.all()).filter(e=>e.missionId===missionId);}
}
