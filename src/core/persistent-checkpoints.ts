import {JsonStateStore} from "./persistence.js";
import type {Checkpoint} from "./recovery.js";
export class PersistentCheckpoints{
 constructor(private readonly store:JsonStateStore<Checkpoint[]>){}
 async save(checkpoint:Checkpoint){const all=await this.store.load()??[];const next=all.filter(x=>x.missionId!==checkpoint.missionId);next.push(checkpoint);await this.store.save(next);}
 async restore(missionId:string){return(await this.store.load()??[]).find(x=>x.missionId===missionId);}
}
