import type {MemoryRecord} from "./memory.js";
import {JsonStateStore} from "../core/persistence.js";
export class MemoryBackup{
 constructor(private readonly store:JsonStateStore<MemoryRecord[]>){}
 async export(){return await this.store.load()??[];}
 async restore(records:MemoryRecord[]){await this.store.save(records);}
}
