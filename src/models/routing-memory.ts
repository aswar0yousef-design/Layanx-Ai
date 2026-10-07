import fs from "node:fs";
import path from "node:path";
import {searchTerms} from "../memory/text-normalize.js";

/**
 * Learned routing (the idea behind RouteLLM, from LayanX's own history instead of a trained model):
 * when the local model has failed to plan goals like this one at least twice and has not succeeded
 * on them since, the next similar goal goes straight to the cloud model (if the cloud policy allows),
 * instead of wasting a slow local attempt first. A later local success wins the goal back.
 */
export type RouteOutcome="local_ok"|"local_failed"|"cloud_ok";
interface Entry{terms:string[];outcome:RouteOutcome;at:string}

const jaccard=(a:Set<string>,b:Set<string>)=>{let inter=0;for(const x of a)if(b.has(x))inter++;return inter/Math.max(1,a.size+b.size-inter);};

export class RoutingMemory{
  private memory:Entry[]=[];
  constructor(private readonly file:string|null){}
  static forStore(env:NodeJS.ProcessEnv=process.env):RoutingMemory{
    return new RoutingMemory(env.LAYANX_STORE_DIR?path.join(env.LAYANX_STORE_DIR,"routing-history.json"):null);
  }
  private read():Entry[]{if(!this.file)return this.memory;try{return JSON.parse(fs.readFileSync(this.file,"utf8")) as Entry[];}catch{return[];}}
  private write(entries:Entry[]){
    this.memory=entries.slice(-500);
    if(!this.file)return;
    try{fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+".tmp";fs.writeFileSync(tmp,JSON.stringify(this.memory));fs.renameSync(tmp,this.file);}catch{}
  }
  record(goal:string,outcome:RouteOutcome):void{
    const terms=searchTerms(goal).slice(0,30);if(!terms.length)return;
    const all=this.read();all.push({terms,outcome,at:new Date().toISOString()});this.write(all);
  }
  /** Similar past goals (term overlap >= 0.5), newest last. */
  similar(goal:string):Entry[]{
    const q=new Set(searchTerms(goal));if(!q.size)return[];
    return this.read().filter(e=>jaccard(q,new Set(e.terms))>=0.5);
  }
  suggestCloud(goal:string):boolean{
    const hits=this.similar(goal);
    const lastLocalOk=hits.map(e=>e.outcome).lastIndexOf("local_ok");
    const failuresSince=hits.slice(lastLocalOk+1).filter(e=>e.outcome==="local_failed").length;
    return failuresSince>=2;
  }
}
