import {copyFile} from "node:fs/promises";
import {BackupManager,BackupRecord} from "./backup-manager.js";
export class RestoreManager{
 constructor(private readonly backups=new BackupManager()){}
 async restore(record:BackupRecord,target:string){
  if(!await this.backups.verify(record))throw new Error("Backup checksum verification failed.");
  await copyFile(record.destination,target);
  return{restored:true,target};
 }
}
