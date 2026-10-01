import {createHash} from "node:crypto";
export interface ReleaseManifest{version:string;commitSha:string;createdAt:string;artifacts:string[];checksum:string;}
export function createReleaseManifest(input:Omit<ReleaseManifest,"checksum"|"createdAt">):ReleaseManifest{
 const createdAt=new Date().toISOString();
 const checksum=createHash("sha256").update(JSON.stringify({...input,createdAt})).digest("hex");
 return{...input,createdAt,checksum};
}
