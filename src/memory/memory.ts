export type MemoryKind="conversation"|"project"|"task"|"decision"|"semantic"|"episodic";
export interface MemoryRecord{id:string;kind:MemoryKind;projectId?:string;content:string;tags:string[];createdAt:string;expiresAt?:string;}
export interface MemoryStore{put(record:MemoryRecord):Promise<void>;search(query:string,kind?:MemoryKind,limit?:number):Promise<MemoryRecord[]>;}
export class InMemoryStore implements MemoryStore{
 private readonly records:MemoryRecord[]=[];
 async put(record:MemoryRecord){this.records.push({...record});}
 async search(query:string,kind?:MemoryKind,limit=10){const q=query.toLowerCase();return this.records.filter(r=>(!kind||r.kind===kind)&&r.content.toLowerCase().includes(q)).slice(0,limit);}
}
