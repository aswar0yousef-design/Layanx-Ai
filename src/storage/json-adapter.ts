import type {StorageAdapter,Transaction} from "./repository.js";
import {FileLock} from "./file-lock.js";

export class JsonStorageAdapter implements StorageAdapter{
  private readonly lock:FileLock;
  constructor(private readonly path:string){
    this.lock=new FileLock(path+".tx.lock");
  }

  async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
    const release=await this.lock.acquire();
    const staged=new Map<string,unknown>();
    let closed=false;
    const tx:Transaction={
      get:async<T>(key:string)=>{
        if(staged.has(key))return structuredClone(staged.get(key)) as T;
        return undefined;
      },
      set:async<T>(key:string,value:T)=>{if(closed)throw new Error("Transaction is closed.");staged.set(key,structuredClone(value));},
      commit:async()=>{closed=true;},
      rollback:async()=>{staged.clear();closed=true;}
    };
    try{
      const result=await work(tx);
      await tx.commit();
      return result;
    }catch(error){
      await tx.rollback();
      throw error;
    }finally{await release();}
  }

  path(){return this.path;}
}
