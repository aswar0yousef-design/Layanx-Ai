import type {MemoryKind,MemoryRecord,MemoryStore} from "./memory.js";
export interface ContextRequest{query:string;kinds?:MemoryKind[];limit?:number;projectId?:string;}
export class ContextResolver{
 constructor(private readonly store:MemoryStore){}
 async resolve(request:ContextRequest):Promise<MemoryRecord[]>{
  const kinds=request.kinds?.length?request.kinds:[undefined];
  const found:MemoryRecord[]=[];
  for(const kind of kinds){const rows=await this.store.search(request.query,kind,request.limit??10);for(const row of rows){if(request.projectId&&row.projectId!==request.projectId)continue;if(!found.some(x=>x.id===row.id))found.push(row);}}
  return found.slice(0,request.limit??10);
 }
}
