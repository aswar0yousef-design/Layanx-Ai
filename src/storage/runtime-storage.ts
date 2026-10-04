import type {StorageAdapter,Transaction} from "./repository.js";
import {JsonStorageAdapter} from "./json-adapter.js";
export interface RuntimeStorageKeys{snapshot:string;}
class MemoryStorage implements StorageAdapter{
 private state:Record<string,unknown>={};
 async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
  const staged=new Map<string,unknown>();let closed=false;
  const tx:Transaction={
   get:async<T>(key:string)=>structuredClone(staged.has(key)?staged.get(key):this.state[key]) as T|undefined,
   set:async<T>(key:string,value:T)=>{if(closed)throw new Error("Transaction is closed.");staged.set(key,structuredClone(value));},
   commit:async()=>{if(closed)return;for(const [key,value] of staged)this.state[key]=structuredClone(value);closed=true;},
   rollback:async()=>{staged.clear();closed=true;}
  };
  try{const result=await work(tx);if(!closed)await tx.commit();return result;}catch(error){await tx.rollback();throw error;}
 }
}
export class RuntimeStorage{
 private writeQueue:Promise<void>=Promise.resolve();
 constructor(private readonly storage:StorageAdapter=new MemoryStorage(),private readonly keys:RuntimeStorageKeys={snapshot:"runtime:snapshots"}){}
 async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{await this.writeQueue;return this.storage.transaction(work);}
 async get<T>(key=this.keys.snapshot):Promise<T|undefined>{await this.writeQueue;return this.storage.transaction(async tx=>tx.get<T>(key));}
 async set<T>(value:T,key=this.keys.snapshot):Promise<void>{this.writeQueue=this.writeQueue.then(()=>this.storage.transaction(async tx=>{await tx.set(key,value);}));await this.writeQueue;}
 static json(path:string):RuntimeStorage{return new RuntimeStorage(new JsonStorageAdapter(path));}
}
