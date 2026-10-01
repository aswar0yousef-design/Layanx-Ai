import {JsonStateStore} from "../core/persistence.js";
import type {StorageAdapter,Transaction} from "./repository.js";
import {FileLock} from "./file-lock.js";

type State=Record<string,unknown>;

export class JsonStorageAdapter implements StorageAdapter{
  private readonly store:JsonStateStore<State>;
  private readonly lock:FileLock;
  constructor(private readonly path:string){
    this.store=new JsonStateStore<State>(path);
    this.lock=new FileLock(path+".tx.lock");
  }

  async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
    const release=await this.lock.acquire();
    const state=await this.store.load()??{};
    const staged=new Map<string,unknown>();
    let closed=false;
    const tx:Transaction={
      get:async<T>(key:string)=>{
        if(staged.has(key))return structuredClone(staged.get(key)) as T;
        return structuredClone(state[key]) as T|undefined;
      },
      set:async<T>(key:string,value:T)=>{
        if(closed)throw new Error("Transaction is closed.");
        staged.set(key,structuredClone(value));
      },
      commit:async()=>{
        if(closed)return;
        for(const [key,value] of staged)state[key]=structuredClone(value);
        await this.store.save(state);
        closed=true;
      },
      rollback:async()=>{staged.clear();closed=true;}
    };
    try{
      const result=await work(tx);
      if(!closed)await tx.commit();
      return result;
    }catch(error){
      await tx.rollback();
      throw error;
    }finally{await release();}
  }

  filePath(){return this.path;}
}
