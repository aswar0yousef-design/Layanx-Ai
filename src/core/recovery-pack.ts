import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
export interface RecoveryArtifact{path:string;size:number;sha256:string;}
export interface RecoveryManifest{formatVersion:1;createdAt:string;systemVersion:string;artifacts:RecoveryArtifact[];}
export class RecoveryPack{
 async checksum(path:string){const data=await readFile(path);return createHash("sha256").update(data).digest("hex");}
 async artifact(path:string):Promise<RecoveryArtifact>{const data=await readFile(path);return{path,size:data.byteLength,sha256:createHash("sha256").update(data).digest("hex")};}
 createManifest(systemVersion:string,artifacts:RecoveryArtifact[]):RecoveryManifest{return{formatVersion:1,createdAt:new Date().toISOString(),systemVersion,artifacts};}
}
