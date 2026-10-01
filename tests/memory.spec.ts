import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {JsonStateStore} from "../src/core/persistence.js";
import {PersistentMemoryStore} from "../src/memory/persistent-memory.js";
import {MemoryFirewall} from "../src/memory/memory-firewall.js";
const dir=await mkdtemp(join(tmpdir(),"layanx-memory-"));
const store=new PersistentMemoryStore(new JsonStateStore(join(dir,"memory.json")));
await store.put({id:"m1",kind:"project",projectId:"p1",content:"LayanX project decision",tags:["architecture"],createdAt:new Date().toISOString()});
if((await store.search("architecture")).length!==1)throw new Error("Persistent memory search failed.");
let rejected=false;try{new MemoryFirewall().sanitize({id:"s",kind:"semantic",content:"api_key=secret",tags:[],createdAt:new Date().toISOString()});}catch{rejected=true;}
if(!rejected)throw new Error("Memory firewall failed.");
await rm(dir,{recursive:true,force:true});
console.log("Memory persistence and firewall test passed.");
