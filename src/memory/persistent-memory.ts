import {JsonStateStore} from "../core/persistence.js";
import type {MemoryRecord,MemoryStore} from "./memory.js";
export class PersistentMemoryStore implements MemoryStore{
 constructor(private readonly store:JsonStateStore<MemoryRecord[]>){}
 async put(record:MemoryRecord):Promise<void>{const all=await this.store.load()??[];const next=all.filter(x=>x.id!==record.id);next.push(record);await this.store.save(next);}
 async search(query:string,limit=20):Promise<MemoryRecord[]>{const q=query.toLowerCase();return(await this.store.load()??[]).filter(x=>!x.expiresAt||Date.parse(x.expiresAt)>Date.now()).filter(x=>x.content.toLowerCase().includes(q)||x.tags.some(t=>t.toLowerCase().includes(q))).slice(0,limit);}
 async all():Promise<MemoryRecord[]>{return(await this.store.load()??[]).filter(x=>!x.expiresAt||Date.parse(x.expiresAt)>Date.now());}
}
