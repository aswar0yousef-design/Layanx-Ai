export type MemoryKind="fact"|"decision"|"experience"|"success"|"failure"|"handoff";

export interface MemoryEntry{
  id:string;
  missionId:string;
  projectId?:string;
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

  recall(query:string,limit=10,projectId?:string){
    const terms=query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(term=>term.length>1);
    const now=Date.now();
    return [...this.entries.values()]
      .filter(entry=>!projectId||entry.projectId===projectId)
      .map(entry=>{
        const haystack=(entry.summary+" "+entry.tags.join(" ")+" "+JSON.stringify(entry.content)).toLowerCase();
        const matched=new Set(terms.filter(term=>haystack.includes(term)));
        const lexical=matched.size;
        const kindBoost=entry.kind==="decision"||entry.kind==="failure"||entry.kind==="success"?1.5:1;
        const confidence=Math.max(0,Math.min(1,entry.confidence));
        const ageDays=Math.max(0,(now-Date.parse(entry.createdAt))/86400000);
        const recencyBoost=1/(1+ageDays/30);
        return{entry,haystack,score:lexical*kindBoost*confidence*recencyBoost};
      })
      .filter(item=>terms.length===0||terms.every(term=>item.haystack.includes(term)))
      .sort((a,b)=>b.score-a.score)
      .slice(0,limit)
      .map(item=>structuredClone(item.entry));
  }

  list(){return[...this.entries.values()].map(entry=>structuredClone(entry));}

  restore(entries:MemoryEntry[]){
    for(const entry of entries)this.entries.set(entry.id,structuredClone({...entry,content:sanitize(entry.content)}));
  }
}
