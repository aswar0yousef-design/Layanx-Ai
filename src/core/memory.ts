export type MemoryKind="fact"|"decision"|"experience"|"success"|"failure"|"handoff";

export interface MemoryEntry{
  id:string;
  missionId:string;
  kind:MemoryKind;
  summary:string;
  content:unknown;
  confidence:number;
  tags:string[];
  createdAt:string;
}

const sensitiveKey=/api[_ -]?key|secret|password|token|authorization|private[_ -]?key|credential/i;
const bearer=/bearer\s+[A-Za-z0-9._-]{8,}/gi;

function sanitize(value:unknown):unknown{
  if(typeof value==="string")return value.replace(bearer,"[REDACTED]");
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==="object"){
    const output:Record<string,unknown>={};
    for(const [key,item] of Object.entries(value)){
      output[key]=sensitiveKey.test(key)?"[REDACTED]":sanitize(item);
    }
    return output;
  }
  return value;
}

export class MemoryEngine{
  private readonly entries=new Map<string,MemoryEntry>();

  remember(input:Omit<MemoryEntry,"id"|"createdAt"|"content"> & {content:unknown}){
    if(input.confidence<0||input.confidence>1)throw new Error("Memory confidence must be between 0 and 1.");
    const entry:MemoryEntry={...input,id:crypto.randomUUID(),createdAt:new Date().toISOString(),content:sanitize(input.content)};
    this.entries.set(entry.id,structuredClone(entry));
    return structuredClone(entry);
  }

  recall(query:string,limit=10){
    const terms=query.toLowerCase().split(/[^a-z0-9]+/).filter(term=>term.length>2);
    return [...this.entries.values()]
      .map(entry=>({entry,score:terms.filter(term=>(entry.summary+" "+entry.tags.join(" ")).toLowerCase().includes(term)).length}))
      .filter(item=>item.score>0)
      .sort((a,b)=>b.score-a.score)
      .slice(0,limit)
      .map(item=>structuredClone(item.entry));
  }

  list(){return[...this.entries.values()].map(entry=>structuredClone(entry));}

  restore(entries:MemoryEntry[]){
    for(const entry of entries)this.entries.set(entry.id,structuredClone({...entry,content:sanitize(entry.content)}));
  }
}
