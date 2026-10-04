import type {JsonStateStore} from "../core/persistence.js";
import type {StorageAdapter,Transaction} from "./repository.js";

export class StateStoreAdapter<T>{
 constructor(private readonly store:JsonStateStore<T>,private readonly key="items"){}
 async transaction<R>(work:(tx:Transaction)=>Promise<R>):Promise<R>{
  let value:T|undefined=await this.store.load();
  let closed=false;
  const tx:Transaction={
   get:async<K>(key:string)=>key===this.key?structuredClone(value) as K:undefined,
   set:async<K>(key:string,next:K)=>{if(closed)throw new Error("Transaction is closed.");if(key!==this.key)throw new Error("Unknown state-store key.");value=structuredClone(next as unknown as T);},
   commit:async()=>{if(closed)return;if(value===undefined)await this.store.save(value as T);else await this.store.save(value);closed=true;},
   rollback:async()=>{closed=true;}
  };
  try{const result=await work(tx);if(!closed)await tx.commit();return result;}catch(error){await tx.rollback();throw error;}
 }
}
