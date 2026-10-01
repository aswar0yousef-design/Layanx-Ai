import type {Repository,StorageAdapter} from "./repository.js";

export class JsonRepository<T extends {id:string}> implements Repository<T>{
  constructor(private readonly storage:StorageAdapter,private readonly key:string){}
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
