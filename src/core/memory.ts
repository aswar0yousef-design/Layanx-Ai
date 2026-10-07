import {cosine,indexTerms,normalizeText,searchTerms} from "../memory/text-normalize.js";
import {VectorStore} from "../memory/vector-store.js";

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

const SEMANTIC_ONLY_THRESHOLD=0.55;
/** Function words ignored when the query has other terms (normalised forms). */
const STOPWORDS=new Set(["the","a","an","and","or","of","to","in","on","for","with","is","are","was","be","it","this","that","from","by","at","as",
  "how","what","why","when","where","which","who","can","do","does","please","i","we","you","my","our",
  "في","من","علي","الي","عن","مع","هذا","هذه","ذلك","التي","الذي","او","ثم","ان","كان","قد","لا","ما","هل","كل","بعد","قبل","عند",
  "هو","هي","هم","انا","انت","نحن","كيف","ماذا","لماذا","متي","اين","ايش","شو","اريد","ممكن","يمكن","لو","حل","مشكل"]);

export class MemoryEngine{
  private readonly entries=new Map<string,MemoryEntry>();
  private readonly termIndex=new Map<string,{terms:Set<string>;text:string}>();
  private embedder?:{model:string;embed:(texts:string[])=>Promise<number[][]>};
  private embedderPausedUntil=0;
  private vectors=new VectorStore();

  remember(input:Omit<MemoryEntry,"id"|"createdAt"|"content"> & {content:unknown}){
    if(input.confidence<0||input.confidence>1)throw new Error("Memory confidence must be between 0 and 1.");
    const entry:MemoryEntry={...input,id:crypto.randomUUID(),createdAt:new Date().toISOString(),content:sanitize(input.content)};
    this.entries.set(entry.id,structuredClone(entry));
    return structuredClone(entry);
  }

  /**
   * Lexical recall, Arabic- and English-aware: normalised + lightly stemmed terms, IDF-weighted.
   * Short queries (1-2 terms) need every term; longer ones need half of them (function words ignored), so
   * "اصلاح صفحة الدفع في المتجر" still finds "تم إصلاح صفحة الدفع".
   */
  recall(query:string,limit=10,projectId?:string){
    return this.scored(query,projectId).slice(0,limit).map(item=>structuredClone(item.entry));
  }

  /**
   * Hybrid recall: lexical scores mixed with embedding similarity when an embedder is configured
   * (Ollama embedding model). Any embedding failure falls back to lexical recall.
   */
  async recallAsync(query:string,limit=10,projectId?:string):Promise<MemoryEntry[]>{
    const lexical=this.scored(query,projectId);
    if(!this.embedder||Date.now()<this.embedderPausedUntil||!query.trim())return lexical.slice(0,limit).map(item=>structuredClone(item.entry));
    try{
      const embedder=this.embedder;
      const [queryVector]=await embedder.embed([query.slice(0,2000)]);
      if(!queryVector?.length)throw new Error("empty query embedding");
      const pool=[...this.entries.values()].filter(entry=>!projectId||entry.projectId===projectId).slice(-400);
      const missing=pool.filter(entry=>!this.vectors.get(entry.id,embedder.model)).slice(-128);
      for(let i=0;i<missing.length;i+=32){
        const batch=missing.slice(i,i+32);
        const vectors=await embedder.embed(batch.map(entry=>this.indexText(entry).slice(0,2000)));
        batch.forEach((entry,j)=>{const v=vectors[j];if(v?.length)this.vectors.put(entry.id,embedder.model,v);});
      }
      const maxLexical=Math.max(1e-9,...lexical.map(item=>item.score));
      const lexicalById=new Map(lexical.map(item=>[item.entry.id,item.score/maxLexical]));
      const combined=pool.map(entry=>{
        const vector=this.vectors.get(entry.id,embedder.model);
        const semantic=vector?Math.max(0,cosine(queryVector,vector)):0;
        const lex=lexicalById.get(entry.id);
        return{entry,score:lex!==undefined?0.6*lex+0.4*semantic:semantic>=SEMANTIC_ONLY_THRESHOLD?0.4*semantic:-1};
      }).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score);
      return combined.slice(0,limit).map(item=>structuredClone(item.entry));
    }catch{
      this.embedderPausedUntil=Date.now()+10*60_000;
      return lexical.slice(0,limit).map(item=>structuredClone(item.entry));
    }
  }

  /** Enable semantic recall. embed() returns one vector per text; model names the vector space. */
  setEmbedder(embedder:{model:string;embed:(texts:string[])=>Promise<number[][]>}|undefined,vectors?:VectorStore){
    this.embedder=embedder;this.embedderPausedUntil=0;
    if(vectors)this.vectors=vectors;
  }
  semanticEnabled(){return Boolean(this.embedder)&&Date.now()>=this.embedderPausedUntil;}

  private indexText(entry:MemoryEntry){
    let content="";try{content=JSON.stringify(entry.content)??"";}catch{}
    return entry.summary+" "+entry.tags.join(" ")+" "+content.slice(0,4000);
  }
  private termsOf(entry:MemoryEntry){
    let cached=this.termIndex.get(entry.id);
    if(!cached){const text=this.indexText(entry);cached={terms:indexTerms(text),text:normalizeText(text)};this.termIndex.set(entry.id,cached);}
    return cached;
  }
  private scored(query:string,projectId?:string){
    const all=searchTerms(query);
    const meaningful=all.filter(term=>!STOPWORDS.has(term));
    const terms=meaningful.length?meaningful:all;
    const now=Date.now();
    const candidates=[...this.entries.values()].filter(entry=>!projectId||entry.projectId===projectId);
    const has=(index:{terms:Set<string>;text:string},term:string)=>index.terms.has(term)||(term.length>=4&&index.text.includes(term));
    const df=new Map(terms.map(term=>[term,candidates.filter(entry=>has(this.termsOf(entry),term)).length]));
    const need=terms.length<=2?terms.length:Math.ceil(terms.length*0.5);
    return candidates
      .map((entry,order)=>{
        const index=this.termsOf(entry);
        const matched=terms.filter(term=>has(index,term));
        const lexical=matched.reduce((sum,term)=>sum+Math.log(1+candidates.length/(1+(df.get(term)??0))),0)*(0.5+0.5*matched.length/Math.max(1,terms.length));
        const kindBoost=entry.kind==="decision"||entry.kind==="failure"||entry.kind==="success"?1.5:1;
        const confidence=Math.max(0,Math.min(1,entry.confidence));
        const ageDays=Math.max(0,(now-Date.parse(entry.createdAt))/86400000);
        const recencyBoost=1/(1+ageDays/30);
        return{entry,order,matched:matched.length,score:lexical*kindBoost*confidence*recencyBoost};
      })
      .filter(item=>terms.length===0||item.matched>=need)
      .sort((a,b)=>b.score-a.score||a.order-b.order);
  }

  list(){return[...this.entries.values()].map(entry=>structuredClone(entry));}

  restore(entries:MemoryEntry[]){
    for(const entry of entries){this.entries.set(entry.id,structuredClone({...entry,content:sanitize(entry.content)}));this.termIndex.delete(entry.id);}
  }
}
