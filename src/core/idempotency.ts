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

export class IdempotencyStore{
  private readonly records=new Map<string,IdempotencyRecord>();

  begin(request:ToolRequest):{ok:true;record:IdempotencyRecord}|{ok:false;record:IdempotencyRecord}{
    const existing=this.records.get(request.idempotencyKey);
    if(existing)return{ok:false,record:structuredClone(existing)};
    const record:IdempotencyRecord={
      key:request.idempotencyKey,missionId:request.missionId,agentId:request.agentId,
      tool:request.tool,action:request.action,status:"running",createdAt:new Date().toISOString()
    };
    this.records.set(record.key,record);
    return{ok:true,record:structuredClone(record)};
  }

  complete(key:string,data:unknown):void{
    const record=this.require(key);
    this.records.set(key,{...record,status:"completed",completedAt:new Date().toISOString(),data:structuredClone(data)});
  }

  fail(key:string,error:string):void{
    const record=this.require(key);
    this.records.set(key,{...record,status:"failed",completedAt:new Date().toISOString(),error});
  }

  get(key:string){const record=this.records.get(key);return record?structuredClone(record):undefined;}

  private require(key:string):IdempotencyRecord{
    const record=this.records.get(key);
    if(!record)throw new Error("Unknown idempotency key.");
    return record;
  }
}
