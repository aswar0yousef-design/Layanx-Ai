import {JsonStateStore} from "../core/persistence.js";
import type {MemoryRecord,MemoryStore,MemoryKind} from "./memory.js";
export class PersistentMemoryStore implements MemoryStore{
 constructor(private readonly store:JsonStateStore<MemoryRecord[]>){}
 async put(record:MemoryRecord):Promise<void>{const all=await this.store.load()??[];const next=all.filter(x=>x.id!==record.id);next.push(record);await this.store.save(next);}
 async search(query:string,kindOrLimit?:MemoryKind|number,limit=20):Promise<MemoryRecord[]>{
  const kind=typeof kindOrLimit==="string"?kindOrLimit:undefined;
  const effectiveLimit=typeof kindOrLimit==="number"?kindOrLimit:limit;
  const q=query.toLowerCase();return(await this.store.load()??[]).filter(x=>(!kind||x.kind===kind)&&(!x.expiresAt||Date.parse(x.expiresAt)>Date.now())).filter(x=>x.content.toLowerCase().includes(q)||x.tags.some(t=>t.toLowerCase().includes(q))).slice(0,effectiveLimit);
 }
 async all():Promise<MemoryRecord[]>{return(await this.store.load()??[]).filter(x=>!x.expiresAt||Date.parse(x.expiresAt)>Date.now());}
}
