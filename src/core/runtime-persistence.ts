import type {Mission} from "./types.js";
import type {LedgerEntry} from "./ledger.js";
import type {AuditEvent} from "./audit.js";
import type {Checkpoint} from "./recovery.js";
import type {ExecutionState} from "./execution-state.js";
import type {IdempotencyRecord} from "./idempotency.js";
import type {MemoryEntry} from "./memory.js";
import type {MissionHandoff} from "./handoff.js";
import {RuntimeStorage} from "../storage/runtime-storage.js";

export const RUNTIME_SNAPSHOT_VERSION=1;
export interface RuntimeSnapshotMigration{from:number;to:number;up:(snapshot:unknown)=>unknown;}

export interface RuntimeSnapshot{
  mission:Mission;
  executionState:ExecutionState;
  ledger:LedgerEntry[];
  audit:AuditEvent[];
  checkpoint?:Checkpoint;
  idempotency?:IdempotencyRecord[];
  memory?:MemoryEntry[];
  handoffs?:MissionHandoff[];
  delegatedTasks?:import("./delegation.js").DelegatedTask[];
  nextAction?:import("./next-action.js").NextAction;
  savedAt:string;
  schemaVersion:number;
}

export class RuntimePersistence{
  private cleanupTimer?:ReturnType<typeof setInterval>;
  constructor(private readonly storage:RuntimeStorage,private readonly migrations:RuntimeSnapshotMigration[]=[]){
    this.assertMigrationChain();
  }

  private assertMigrationChain():void{
    const seen=new Set<number>();
    for(const migration of this.migrations){
      if(seen.has(migration.from))throw new Error("Duplicate runtime snapshot migration.");
      seen.add(migration.from);
      if(migration.to!==migration.from+1)throw new Error("Runtime snapshot migrations must advance one version at a time.");
    }
  }

  private migrate(snapshot:unknown):RuntimeSnapshot{
    let current=snapshot as {schemaVersion?:number};
    while(current.schemaVersion!==RUNTIME_SNAPSHOT_VERSION){
      const migration=this.migrations.find(item=>item.from===current.schemaVersion);
      if(!migration)throw new Error("Unsupported runtime snapshot version.");
      current=migration.up(structuredClone(current)) as {schemaVersion?:number};
    }
    return current as RuntimeSnapshot;
  }
  private validate(snapshot:RuntimeSnapshot):void{
    if(snapshot.schemaVersion!==RUNTIME_SNAPSHOT_VERSION)throw new Error("Unsupported runtime snapshot version.");
    if(snapshot.mission.id!==snapshot.executionState.missionId)throw new Error("Runtime snapshot mission/state mismatch.");
    if(snapshot.ledger.some(entry=>entry.missionId!==snapshot.mission.id))throw new Error("Runtime snapshot ledger mismatch.");
    if(snapshot.audit.some(event=>event.metadata?.missionId!==undefined && event.metadata.missionId!==snapshot.mission.id))throw new Error("Runtime snapshot audit mismatch.");
    if(snapshot.checkpoint && snapshot.checkpoint.missionId!==snapshot.mission.id)throw new Error("Runtime snapshot checkpoint mismatch.");
    if(snapshot.idempotency?.some(record=>record.missionId!==snapshot.mission.id))throw new Error("Runtime snapshot idempotency mismatch.");
    if(snapshot.memory?.some(entry=>entry.missionId!==snapshot.mission.id))throw new Error("Runtime snapshot memory mismatch.");
    if(snapshot.handoffs?.some(handoff=>handoff.missionId!==snapshot.mission.id))throw new Error("Runtime snapshot handoff mismatch.");
    if(snapshot.delegatedTasks?.some(task=>task.parentMissionId!==snapshot.mission.id))throw new Error("Runtime snapshot delegated-task mismatch.");
    if(snapshot.delegatedTasks){
      const taskIds=new Set(snapshot.delegatedTasks.map(task=>task.id));
      if(snapshot.delegatedTasks.some(task=>task.dependsOn.some(dependencyId=>dependencyId===task.id||!taskIds.has(dependencyId))))
        throw new Error("Runtime snapshot delegated-task dependency mismatch.");
    }
    if(snapshot.nextAction && snapshot.nextAction.missionId!==snapshot.mission.id)throw new Error("Runtime snapshot next-action mismatch.");
  }

  async save(snapshot:RuntimeSnapshot):Promise<void>{
    this.validate(snapshot);
    const current=await this.list();
    const next=current.filter(x=>x.mission.id!==snapshot.mission.id);
    next.push(structuredClone(snapshot));
    await this.storage.set(next);
  }

  async saveAtomic(snapshot:RuntimeSnapshot):Promise<void>{
    this.validate(snapshot);
    await this.storage.transaction(async tx=>{
      const current=(await tx.get<RuntimeSnapshot[]>("runtime:snapshots"))??[];
      const next=current.filter(x=>x.mission.id!==snapshot.mission.id);
      next.push(structuredClone(snapshot));
      await tx.set("runtime:snapshots",next);
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
      (x.executionState.status==="failed"&&x.executionState.recoverable)||
      x.mission.status==="running"||
      x.mission.status==="verifying"
    );
  }

  startAutoCleanup(intervalMs=24*60*60*1000,retentionMs=7*24*60*60*1000):void{
    this.stopAutoCleanup();
    this.cleanupTimer=setInterval(()=>{void this.cleanup(retentionMs).catch(()=>undefined);},intervalMs);
    this.cleanupTimer.unref?.();
  }

  stopAutoCleanup():void{
    if(this.cleanupTimer){clearInterval(this.cleanupTimer);this.cleanupTimer=undefined;}
  }

  async cleanup(retentionMs=7*24*60*60*1000,now=Date.now()):Promise<{removed:number;kept:number}>{
    if(retentionMs<0)throw new Error("Snapshot retention must be non-negative.");
    return this.storage.transaction(async tx=>{
      const raw=await tx.get<unknown[]>("runtime:snapshots")??[];
      const snapshots=raw.map(snapshot=>this.migrate(snapshot));
      snapshots.forEach(snapshot=>this.validate(snapshot));
      const cutoff=now-retentionMs;
      const kept=snapshots.filter(snapshot=>{
        const resumable=
          snapshot.executionState.status==="running"||
          (snapshot.executionState.status==="failed"&&snapshot.executionState.recoverable)||
          snapshot.mission.status==="running"||
          snapshot.mission.status==="verifying";
        return resumable||Date.parse(snapshot.savedAt)>=cutoff;
      });
      await tx.set("runtime:snapshots",kept);
      return{removed:snapshots.length-kept.length,kept:kept.length};
    });
  }
}
