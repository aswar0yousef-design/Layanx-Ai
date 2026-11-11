import fs from "node:fs";
import path from "node:path";

export interface ModelUsage{modelId:string;provider:string;calls:number;ok:number;failed:number;totalMs:number;inputTokens:number;outputTokens:number;lastUsedAt?:string;lastError?:string;lastErrorAt?:string}
export interface ModelCall{modelId:string;provider:string;ms:number;ok:boolean;error?:string;inputTokens?:number;outputTokens?:number}

/** What each model actually did: counted where the call happens, so the dashboard has nothing to estimate. */
export class ModelStats{
  private usage:Record<string,ModelUsage>={};
  constructor(private readonly file:string|null){
    if(file)try{this.usage=JSON.parse(fs.readFileSync(file,"utf8")) as Record<string,ModelUsage>;}catch{}
  }
  static forStore(env:NodeJS.ProcessEnv=process.env):ModelStats{return new ModelStats(env.LAYANX_STORE_DIR?path.join(env.LAYANX_STORE_DIR,"model-stats.json"):null);}
  record(call:ModelCall){
    const row=this.usage[call.modelId]??={modelId:call.modelId,provider:call.provider,calls:0,ok:0,failed:0,totalMs:0,inputTokens:0,outputTokens:0};
    const at=new Date().toISOString();
    row.calls++;row.totalMs+=Math.max(0,Math.round(call.ms));row.lastUsedAt=at;
    row.inputTokens+=call.inputTokens??0;row.outputTokens+=call.outputTokens??0;
    if(call.ok)row.ok++;
    else{row.failed++;row.lastError=String(call.error??"failed").slice(0,300);row.lastErrorAt=at;}
    if(!this.file)return;
    try{fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+".tmp";fs.writeFileSync(tmp,JSON.stringify(this.usage),{mode:0o600});fs.renameSync(tmp,this.file);}catch{}
  }
  list():ModelUsage[]{return Object.values(this.usage).map(row=>({...row})).sort((a,b)=>b.calls-a.calls);}
}
