import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";
import {TransactionalJsonRepository} from "../src/storage/transactional-json-repository.js";
import {MigrationRunner} from "../src/storage/migrations.js";
import {StorageHealth} from "../src/storage/storage-health.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-storage-review-"));
const adapter=new JsonStorageAdapter(join(dir,"state.json"));
const repo=new TransactionalJsonRepository<{id:string;value:number}>(adapter,"items");

await repo.upsert({id:"a",value:1});
await repo.upsert({id:"b",value:2});
if((await repo.list()).length!==2)throw new Error("Transactional repository list failed.");

const migrations=new MigrationRunner([
  {version:1,name:"init",up:async ctx=>{await ctx.set("initialized",true);}},
  {version:2,name:"feature",up:async ctx=>{await ctx.set("featureEnabled",true);}}
]);
const health=new StorageHealth();
const version=await health.migrate(adapter,migrations);
if(version!==2)throw new Error("Migration runner did not reach version 2.");
const result=await health.check(adapter);
if(!result.healthy||!result.writable||result.schemaVersion!==2)throw new Error("Storage health check failed.");

await rm(dir,{recursive:true,force:true});
console.log("Storage integration test passed.");
