import type {StorageAdapter} from "../storage/repository.js";
import {JsonStorageAdapter} from "../storage/json-adapter.js";
import type {RecoveryState} from "./recovery-state-machine.js";

export const RECOVERY_RECORD_VERSION=1;

export interface PersistedRecoveryRecord{
 version:number;
 recoveryId:string;
 deploymentVersion:string;
 deploymentCommitSha:string;
 deploymentChecksum:string;
 state:RecoveryState;
 attempts:number;
 startedAt:string;
 updatedAt:string;
 targetVersion?:string;
 targetCommitSha?:string;
 targetChecksum?:string;
 reason?:string;
}

export class RecoveryPersistence{
 private readonly key="release:recovery";

 constructor(private readonly storage:StorageAdapter){}

 static json(path:string):RecoveryPersistence{
  return new RecoveryPersistence(new JsonStorageAdapter(path));
 }

 async get(recoveryId:string):Promise<PersistedRecoveryRecord|undefined>{
  const record=await this.storage.transaction(async tx=>tx.get<PersistedRecoveryRecord>(this.key));
  if(!record||record.recoveryId!==recoveryId)return undefined;
  this.validate(record);
  return structuredClone(record);
 }

 async save(record:PersistedRecoveryRecord):Promise<void>{
  this.validate(record);
  await this.storage.transaction(async tx=>tx.set(this.key,structuredClone(record)));
 }

 async clear(recoveryId:string):Promise<void>{
  await this.storage.transaction(async tx=>{
   const current=await tx.get<PersistedRecoveryRecord>(this.key);
   if(current?.recoveryId===recoveryId){
    await tx.set(this.key,undefined);
   }
  });
 }

 private validate(record:PersistedRecoveryRecord):void{
  if(record.version!==RECOVERY_RECORD_VERSION)throw new Error("Unsupported recovery record version.");
  if(!record.recoveryId.trim())throw new Error("Recovery id is required.");
  if(!record.deploymentVersion.trim())throw new Error("Deployment version is required.");
  if(!record.deploymentCommitSha.trim())throw new Error("Deployment commit SHA is required.");
  if(!record.deploymentChecksum.trim())throw new Error("Deployment checksum is required.");
  if(record.attempts<0||!Number.isInteger(record.attempts))throw new Error("Recovery attempts must be a non-negative integer.");
 }
}
