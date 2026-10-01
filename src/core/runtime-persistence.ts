import {JsonStateStore} from "./persistence.js";
import type {Mission} from "./types.js";
import type {LedgerEntry} from "./ledger.js";
import type {AuditEvent} from "./audit.js";
import type {Checkpoint} from "./recovery.js";
import type {ExecutionState} from "./execution-state.js";

export interface RuntimeSnapshot{
  mission:Mission;
  executionState:ExecutionState;
  ledger:LedgerEntry[];
  audit:AuditEvent[];
  checkpoint?:Checkpoint;
  savedAt:string;
}

export class RuntimePersistence{
  constructor(private readonly store:JsonStateStore<RuntimeSnapshot[]>){}
  async save(snapshot:RuntimeSnapshot):Promise<void>{
    const current=await this.store.load()??[];
    const next=current.filter(x=>x.mission.id!==snapshot.mission.id);
    next.push(structuredClone(snapshot));
    await this.store.save(next);
  }
  async get(missionId:string):Promise<RuntimeSnapshot|undefined>{
    return (await this.store.load()??[]).find(x=>x.mission.id===missionId);
  }
  async list():Promise<RuntimeSnapshot[]>{return (await this.store.load())??[];}

  async resumable():Promise<RuntimeSnapshot[]>{
    return (await this.list()).filter(x =>
      x.executionState.status==="running" ||
      x.mission.status==="running" ||
      x.mission.status==="verifying"
    );
  }
}
