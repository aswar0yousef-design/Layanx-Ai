import type {ToolRequest} from "./types.js";
import type {IdempotencyClaim,IdempotencyRecord} from "./idempotency.js";
import type {StorageAdapter} from "../storage/repository.js";

export interface IdempotencyService{
  begin(request:ToolRequest):Promise<IdempotencyClaim>;
  complete(key:string,data:unknown):Promise<void>;
  fail(key:string,error:string):Promise<void>;
  get(key:string):Promise<IdempotencyRecord|undefined>;
}

export class TransactionalIdempotencyStore implements IdempotencyService{
  private readonly key="idempotency:records";
  constructor(private readonly storage:StorageAdapter){}
  async begin(request:ToolRequest):Promise<IdempotencyClaim>{
    return this.storage.transaction(async tx=>{
      const records=await tx.get<IdempotencyRecord[]>(this.key)??[];
      const existing=records.find(x=>x.key===request.idempotencyKey);
      if(existing){
        if(existing.missionId!==request.missionId||existing.agentId!==request.agentId||existing.tool!==request.tool||existing.action!==request.action)
          return{accepted:false,replay:false,record:structuredClone(existing),reason:"Idempotency key is already bound to a different operation."};
        if(existing.status==="completed")return{accepted:false,replay:true,record:structuredClone(existing)};
        return{accepted:false,replay:false,record:structuredClone(existing),reason:existing.status==="running"?"Duplicate operation is already in progress.":existing.error??"Previous operation failed."};
      }
      const record:IdempotencyRecord={key:request.idempotencyKey,missionId:request.missionId,agentId:request.agentId,tool:request.tool,action:request.action,status:"running",createdAt:new Date().toISOString()};
      records.push(record);
      await tx.set(this.key,records);
      return{accepted:true,replay:false,record:structuredClone(record)};
    });
  }
  async complete(key:string,data:unknown):Promise<void>{await this.transition(key,{status:"completed",completedAt:new Date().toISOString(),data:structuredClone(data)});}
  async fail(key:string,error:string):Promise<void>{await this.transition(key,{status:"failed",completedAt:new Date().toISOString(),error});}
  async get(key:string){return this.storage.transaction(async tx=>(await tx.get<IdempotencyRecord[]>(this.key)??[]).find(x=>x.key===key));}
  private async transition(key:string,patch:Partial<IdempotencyRecord>):Promise<void>{
    await this.storage.transaction(async tx=>{
      const records=await tx.get<IdempotencyRecord[]>(this.key)??[];
      const index=records.findIndex(x=>x.key===key);
      if(index<0)throw new Error("Unknown idempotency key.");
      const current=records[index];
      if(current.status!=="running")throw new Error("Idempotency record is not running.");
      records[index]={...current,...patch};
      await tx.set(this.key,records);
    });
  }
}
