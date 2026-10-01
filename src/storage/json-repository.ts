import {JsonStateStore} from "../core/persistence.js";
import type {Repository} from "./repository.js";
export class JsonRepository<T extends {id:string}> implements Repository<T>{
 constructor(private readonly store:JsonStateStore<T[]>){}
 async get(id:string){return(await this.store.load()??[]).find(x=>x.id===id);}
 async list(){return await this.store.load()??[];}
 async upsert(value:T){const all=await this.list();const next=all.filter(x=>x.id!==value.id);next.push(value);await this.store.save(next);}
 async remove(id:string){await this.store.save((await this.list()).filter(x=>x.id!==id));}
}
