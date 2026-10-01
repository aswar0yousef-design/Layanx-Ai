import type {ToolRequest} from "./types.js";

export interface IdempotencyRecord{
  key:string;
  missionId:string;
  agentId:string;
  tool:string;
  action:string;
  status:"running"|"completed"|"failed";
  createdAt:string;
  completedAt?:string;
  data?:unknown;
  error?:string;
}

export interface IdempotencyClaim{
  accepted:boolean;
  record:IdempotencyRecord;
  replay:boolean;
  reason?:string;
}

export class IdempotencyStore{
  private readonly records=new Map<string,IdempotencyRecord>();

  begin(request:ToolRequest):IdempotencyClaim{
    const existing=this.records.get(request.idempotencyKey);
    if(existing){
      if(existing.missionId!==request.missionId||existing.agentId!==request.agentId||existing.tool!==request.tool||existing.action!==request.action)
        return{accepted:false,replay:false,record:structuredClone(existing),reason:"Idempotency key is already bound to a different operation."};
      if(existing.status==="completed")return{accepted:false,replay:true,record:structuredClone(existing)};
      if(existing.status==="running")return{accepted:false,replay:false,record:structuredClone(existing),reason:"Duplicate operation is already in progress."};
      return{accepted:false,replay:false,record:structuredClone(existing),reason:existing.error??"Previous operation failed."};
    }
    const record:IdempotencyRecord={
      key:request.idempotencyKey,missionId:request.missionId,agentId:request.agentId,
      tool:request.tool,action:request.action,status:"running",createdAt:new Date().toISOString()
    };
    this.records.set(record.key,record);
    return{accepted:true,replay:false,record:structuredClone(record)};
  }

  complete(key:string,data:unknown):void{
    const record=this.require(key);
    if(record.status!=="running")throw new Error("Idempotency record is not running.");
    this.records.set(key,{...record,status:"completed",completedAt:new Date().toISOString(),data:structuredClone(data)});
  }

  fail(key:string,error:string):void{
    const record=this.require(key);
    if(record.status!=="running")throw new Error("Idempotency record is not running.");
    this.records.set(key,{...record,status:"failed",completedAt:new Date().toISOString(),error});
  }

  get(key:string){const record=this.records.get(key);return record?structuredClone(record):undefined;}

  private require(key:string):IdempotencyRecord{
    const record=this.records.get(key);
    if(!record)throw new Error("Unknown idempotency key.");
    return record;
  }
}
