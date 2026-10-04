import type {Repository,StorageAdapter} from "./repository.js";
import {StateStoreAdapter} from "./state-store-adapter.js";
import type {JsonStateStore} from "../core/persistence.js";

export class JsonRepository<T extends {id:string}> implements Repository<T>{
  constructor(storage:StorageAdapter|JsonStateStore<T[]>,private readonly key="items"){this.storage=storage instanceof Object && "transaction" in storage ? storage as StorageAdapter : new StateStoreAdapter(storage as JsonStateStore<T[]>,key);}
  private readonly storage:StorageAdapter;
  async get(id:string):Promise<T|undefined>{
    return this.storage.transaction(async tx=>(await tx.get<T[]>(this.key)??[]).find(x=>x.id===id));
  }
  async list():Promise<T[]>{
    return this.storage.transaction(async tx=>structuredClone(await tx.get<T[]>(this.key)??[]));
  }
  async upsert(value:T):Promise<void>{
    await this.storage.transaction(async tx=>{
      const all=await tx.get<T[]>(this.key)??[];
      const next=all.filter(x=>x.id!==value.id);
      next.push(structuredClone(value));
      await tx.set(this.key,next);
    });
  }
  async remove(id:string):Promise<void>{
    await this.storage.transaction(async tx=>{
      const all=await tx.get<T[]>(this.key)??[];
      await tx.set(this.key,all.filter(x=>x.id!==id));
    });
  }
}
