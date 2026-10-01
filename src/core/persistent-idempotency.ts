import {JsonStateStore} from "./persistence.js";
import type {IdempotencyRecord} from "./idempotency.js";
import type {ToolRequest} from "./types.js";

export class PersistentIdempotencyStore{
  constructor(private readonly store:JsonStateStore<IdempotencyRecord[]>){}
  async begin(request:ToolRequest):Promise<{ok:true;record:IdempotencyRecord}|{ok:false;record:IdempotencyRecord}>{
    const records=await this.store.load()??[];
    const existing=records.find(x=>x.key===request.idempotencyKey);
    if(existing)return{ok:false,record:structuredClone(existing)};
    const record:IdempotencyRecord={
      key:request.idempotencyKey,missionId:request.missionId,agentId:request.agentId,
      tool:request.tool,action:request.action,status:"running",createdAt:new Date().toISOString()
    };
    records.push(record);
    await this.store.save(records);
    return{ok:true,record:structuredClone(record)};
  }
  async complete(key:string,data:unknown):Promise<void>{await this.update(key,{status:"completed",completedAt:new Date().toISOString(),data:structuredClone(data)});}
  async fail(key:string,error:string):Promise<void>{await this.update(key,{status:"failed",completedAt:new Date().toISOString(),error});}
  async get(key:string){return (await this.store.load()??[]).find(x=>x.key===key);}
  private async update(key:string,patch:Partial<IdempotencyRecord>):Promise<void>{
    const records=await this.store.load()??[];
    const index=records.findIndex(x=>x.key===key);
    if(index<0)throw new Error("Unknown idempotency key.");
    records[index]={...records[index],...patch};
    await this.store.save(records);
  }
}
