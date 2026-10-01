import type {Mission} from "./types.js";
import type {LedgerEntry} from "./ledger.js";
import type {AuditEvent} from "./audit.js";
import type {Checkpoint} from "./recovery.js";
import type {ExecutionState} from "./execution-state.js";
import type {IdempotencyRecord} from "./idempotency.js";
import {RuntimeStorage} from "../storage/runtime-storage.js";

export const RUNTIME_SNAPSHOT_VERSION=1;

export interface RuntimeSnapshot{
  mission:Mission;
  executionState:ExecutionState;
  ledger:LedgerEntry[];
  audit:AuditEvent[];
  checkpoint?:Checkpoint;
  idempotency?:IdempotencyRecord[];
  savedAt:string;
  schemaVersion:number;
}

export class RuntimePersistence{
  constructor(private readonly storage:RuntimeStorage){}
  private validate(snapshot:RuntimeSnapshot):void{
    if(snapshot.schemaVersion!==RUNTIME_SNAPSHOT_VERSION)throw new Error("Unsupported runtime snapshot version.");
    if(snapshot.mission.id!==snapshot.executionState.missionId)throw new Error("Runtime snapshot mission/state mismatch.");
    if(snapshot.checkpoint && snapshot.checkpoint.missionId!==snapshot.mission.id)throw new Error("Runtime snapshot checkpoint mismatch.");
    if(snapshot.idempotency?.some(record=>record.missionId!==snapshot.mission.id))throw new Error("Runtime snapshot idempotency mismatch.");
  }

  async save(snapshot:RuntimeSnapshot):Promise<void>{
    this.validate(snapshot);
    const current=await this.list();
    const next=current.filter(x=>x.mission.id!==snapshot.mission.id);
    next.push(structuredClone(snapshot));
    await this.storage.set(next);
  }

  async saveAtomic(snapshot:RuntimeSnapshot):Promise<void>{
    await this.storage.transaction(async tx=>{
      const current=await tx.get<RuntimeSnapshot[]>()??[];
      const next=current.filter(x=>x.mission.id!==snapshot.mission.id);
      next.push(structuredClone(snapshot));
      await tx.set(next);
    });
  }
  async get(missionId:string):Promise<RuntimeSnapshot|undefined>{
    const snapshot=(await this.list()).find(x=>x.mission.id===missionId);
    if(snapshot)this.validate(snapshot);
    return snapshot;
  }
  async list():Promise<RuntimeSnapshot[]>{
    const snapshots=(await this.storage.get<RuntimeSnapshot[]>())??[];
    snapshots.forEach(snapshot=>this.validate(snapshot));
    return snapshots;
  }
  async resumable():Promise<RuntimeSnapshot[]>{
    return(await this.list()).filter(x=>
      x.executionState.status==="running"||
      x.mission.status==="running"||
      x.mission.status==="verifying"
    );
  }
}
