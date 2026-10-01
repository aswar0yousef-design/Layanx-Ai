import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-tx-"));
const storage=new JsonStorageAdapter(join(dir,"state.json"));

await storage.transaction(async tx=>{
  await tx.set("counter",1);
  const value=await tx.get<number>("counter");
  if(value!==1)throw new Error("Transaction read-your-writes failed.");
});

const persisted=await storage.transaction(tx=>tx.get<number>("counter"));
if(persisted!==1)throw new Error("Committed transaction was not persisted.");

try{
  await storage.transaction(async tx=>{
    await tx.set("counter",2);
    throw new Error("rollback");
  });
}catch{}

const afterRollback=await storage.transaction(tx=>tx.get<number>("counter"));
if(afterRollback!==1)throw new Error("Rollback leaked staged state.");

await rm(dir,{recursive:true,force:true});
console.log("JSON transaction test passed.");
