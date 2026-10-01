import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-storage-facade-"));
const storage=RuntimeStorage.json(join(dir,"runtime.json"));
await storage.set({status:"saved"});
const restored=await storage.get<{status:string}>();
if(restored?.status!=="saved")throw new Error("Storage facade failed to persist state.");

try{
  await new RuntimeStorage({
    transaction:async()=>{throw new Error("forced");}
  }).set({status:"bad"});
}catch{}

const still=await storage.get<{status:string}>();
if(still?.status!=="saved")throw new Error("Failed transaction affected existing state.");

await rm(dir,{recursive:true,force:true});
console.log("Runtime storage facade test passed.");
