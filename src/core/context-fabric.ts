import type {Mission} from "./types.js";
import type {MemoryEntry,MemoryEngine} from "./memory.js";

export interface ContextFabricRequest{
 projectId:string;
 mission:Mission;
 query:string;
 limit?:number;
 maxChars?:number;
}

export interface ContextFabricResult{
 projectId:string;
 missionId:string;
 query:string;
 memories:MemoryEntry[];
 text:string;
 truncated:boolean;
}

export class ContextFabric{
 constructor(private readonly memory:MemoryEngine){}

 build(request:ContextFabricRequest):ContextFabricResult{
  const projectId=request.projectId.trim();
  if(!projectId)throw new Error("Project id is required.");
  if(!request.mission.projectId||request.mission.projectId!==projectId)throw new Error("Project isolation violation.");
  const limit=Math.min(Math.max(request.limit??8,1),50);
  const maxChars=Math.min(Math.max(request.maxChars??12000,500),50000);
  const memories=this.memory.recall(request.query,limit,projectId);
  const prioritized=[...memories].sort((a,b)=>{
   const rank=(kind:MemoryEntry["kind"])=>kind==="decision"?5:kind==="failure"?4:kind==="success"?3:kind==="fact"?2:1;
   return rank(b.kind)-rank(a.kind);
  });
  const sections:string[]=[];
  for(const memory of prioritized){
   const serialized=JSON.stringify({kind:memory.kind,summary:memory.summary,content:memory.content,tags:memory.tags});
   sections.push(serialized);
  }
  let text="";
  let truncated=false;
  for(const section of sections){
   const next=text?text+"
"+section:section;
   if(next.length>maxChars){truncated=true;break;}
   text=next;
  }
  const included=prioritized.filter(memory=>text.includes(memory.summary));
  return{projectId,missionId:request.mission.id,query:request.query,memories:included,text,truncated};
 }
}
