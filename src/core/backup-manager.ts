import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {createHash} from "node:crypto";
export interface BackupRecord{id:string;createdAt:string;source:string;destination:string;sha256:string;}
export class BackupManager{
 async backup(source:string,destination:string):Promise<BackupRecord>{
  const data=await readFile(source);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,data);
  return{id:crypto.randomUUID(),createdAt:new Date().toISOString(),source,destination,sha256:createHash("sha256").update(data).digest("hex")};
 }
 async verify(record:BackupRecord){const data=await readFile(record.destination);return createHash("sha256").update(data).digest("hex")===record.sha256;}
}
