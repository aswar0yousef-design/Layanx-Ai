import {JsonStateStore} from "./persistence.js";
import type {IdempotencyRecord,IdempotencyClaim} from "./idempotency.js";
import type {ToolRequest} from "./types.js";
import {FileLock} from "../storage/file-lock.js";

export class PersistentIdempotencyStore{
  private readonly lock:FileLock;
  constructor(private readonly store:JsonStateStore<IdempotencyRecord[]>,lockPath?:string){
    this.lock=new FileLock(lockPath??store.lockPath());
  }
  async begin(request:ToolRequest):Promise<IdempotencyClaim>{
    const release=await this.lock.acquire();
    try{
      const records=await this.store.load()??[];
      const existing=records.find(x=>x.key===request.idempotencyKey);
      if(existing){
        if(existing.missionId!==request.missionId||existing.agentId!==request.agentId||existing.tool!==request.tool||existing.action!==request.action)
          return{accepted:false,replay:false,record:structuredClone(existing),reason:"Idempotency key is already bound to a different operation."};
        if(existing.status==="completed")return{accepted:false,replay:true,record:structuredClone(existing)};
        return{accepted:false,replay:false,record:structuredClone(existing),reason:existing.status==="running"?"Duplicate operation is already in progress.":existing.error??"Previous operation failed."};
      }
      const record:IdempotencyRecord={key:request.idempotencyKey,missionId:request.missionId,agentId:request.agentId,tool:request.tool,action:request.action,status:"running",createdAt:new Date().toISOString()};
      records.push(record);
      await this.store.save(records);
      return{accepted:true,replay:false,record:structuredClone(record)};
    }finally{await release();}
  }
  async complete(key:string,data:unknown):Promise<void>{await this.update(key,{status:"completed",completedAt:new Date().toISOString(),data:structuredClone(data)});}
  async fail(key:string,error:string):Promise<void>{await this.update(key,{status:"failed",completedAt:new Date().toISOString(),error});}
  async get(key:string){return(await this.store.load()??[]).find(x=>x.key===key);}
  async restore(records:IdempotencyRecord[]):Promise<void>{
    const release=await this.lock.acquire();
    try{
      const existing=await this.store.load()??[];
      const merged=new Map(existing.map(record=>[record.key,record]));
      for(const record of records)merged.set(record.key,structuredClone(record));
      await this.store.save([...merged.values()]);
    }finally{await release();}
  }
  private async update(key:string,patch:Partial<IdempotencyRecord>):Promise<void>{
    const release=await this.lock.acquire();
    try{
      const records=await this.store.load()??[];
      const index=records.findIndex(x=>x.key===key);
      if(index<0)throw new Error("Unknown idempotency key.");
      const current=records[index];
      if(!current)throw new Error("Unknown idempotency key.");
      if(current.status!=="running")throw new Error("Idempotency record is not running.");
      records[index]={...current,...patch};
      await this.store.save(records);
    }finally{await release();}
  }
}
