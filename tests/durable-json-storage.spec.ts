import {mkdtemp,rm,readFile,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {JsonStateStore} from "../src/core/persistence.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-durable-json-"));
const path=join(dir,"state.json");
const store=new JsonStateStore<{status:string}>(path);
await store.save({status:"durable"});

const restored=new JsonStateStore<{status:string}>(path);
if((await restored.load())?.status!=="durable")throw new Error("Durable JSON state did not restore.");

const raw=await readFile(path,"utf8");
if(!raw.includes('"version": 1'))throw new Error("Persisted state envelope is missing.");

const files=await readdir(dir);
if(files.some(file=>file.startsWith("state.json.tmp-")))throw new Error("Temporary persistence file was left behind.");

await rm(dir,{recursive:true,force:true});
console.log("Durable JSON storage tests passed.");
