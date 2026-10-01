import {mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import type {MemoryKind,MemoryRecord,MemoryStore} from "./memory.js";
export class JsonFileMemoryStore implements MemoryStore{
 constructor(private readonly path:string){}
 private async load():Promise<MemoryRecord[]>{try{return JSON.parse(await readFile(this.path,"utf8")) as MemoryRecord[];}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return[];throw error;}}
 private async save(records:MemoryRecord[]){await mkdir(dirname(this.path),{recursive:true});const temp=this.path+".tmp";await writeFile(temp,JSON.stringify(records,null,2),"utf8");await rename(temp,this.path);}
 async put(record:MemoryRecord){const rows=await this.load();const i=rows.findIndex(r=>r.id===record.id);if(i>=0)rows[i]=record;else rows.push(record);await this.save(rows);}
 async search(query:string,kind?:MemoryKind,limit=10){const q=query.toLowerCase();const now=Date.now();return(await this.load()).filter(r=>(!kind||r.kind===kind)&&(!r.expiresAt||Date.parse(r.expiresAt)>now)&&(r.content.toLowerCase().includes(q)||r.tags.some(t=>t.toLowerCase().includes(q)))).slice(0,limit);}
}
