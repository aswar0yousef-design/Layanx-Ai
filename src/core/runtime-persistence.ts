import type {Mission} from "./types.js";
import type {LedgerEntry} from "./ledger.js";
import type {AuditEvent} from "./audit.js";
import type {Checkpoint} from "./recovery.js";
import type {ExecutionState} from "./execution-state.js";
import type {IdempotencyRecord} from "./idempotency.js";
import {RuntimeStorage} from "../storage/runtime-storage.js";

export interface RuntimeSnapshot{
  mission:Mission;
  executionState:ExecutionState;
  ledger:LedgerEntry[];
  audit:AuditEvent[];
  checkpoint?:Checkpoint;
  idempotency?:IdempotencyRecord[];
  savedAt:string;
}

export class RuntimePersistence{
  constructor(private readonly storage:RuntimeStorage){}
  async save(snapshot:RuntimeSnapshot):Promise<void>{
    const current=await this.list();
    const next=current.filter(x=>x.mission.id!==snapshot.mission.id);
    next.push(structuredClone(snapshot));
    await this.storage.set(next);
  }
  async get(missionId:string):Promise<RuntimeSnapshot|undefined>{
    return (await this.list()).find(x=>x.mission.id===missionId);
  }
  async list():Promise<RuntimeSnapshot[]>{return(await this.storage.get<RuntimeSnapshot[]>())??[];}
  async resumable():Promise<RuntimeSnapshot[]>{
    return(await this.list()).filter(x=>
      x.executionState.status==="running"||
      x.mission.status==="running"||
      x.mission.status==="verifying"
    );
  }
}
