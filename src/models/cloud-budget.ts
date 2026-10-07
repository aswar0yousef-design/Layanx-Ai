import fs from "node:fs";
import path from "node:path";
import type {ModelDefinition} from "./registry.js";
import type {ModelResponse} from "./inference.js";

/**
 * Monthly spending cap for paid cloud models (Claude, GPT, Gemini). Every cloud reply is counted
 * (tokens, and dollars when a price is known). When the month's limit is reached, cloud models are
 * skipped and the work stays on the local models until the next month or until the owner raises it.
 *
 *   LAYANX_CLOUD_MONTHLY_BUDGET_USD   e.g. 10   (needs prices: model costPer1k* or the env below)
 *   LAYANX_CLOUD_MONTHLY_TOKENS       e.g. 2000000 (works without prices)
 *   LAYANX_PRICE_<PROVIDER>_IN / _OUT USD per 1M tokens, e.g. LAYANX_PRICE_ANTHROPIC_IN=3
 * Free/local models (local:true or a price of 0) are never limited.
 */
export interface ProviderUsage{calls:number;inputTokens:number;outputTokens:number;costUsd:number;priced:boolean}
export interface UsageFile{month:string;providers:Record<string,ProviderUsage>;blocked?:number}
export interface BudgetStatus{month:string;providers:Record<string,ProviderUsage>;totalTokens:number;totalCostUsd:number;limitUsd:number|null;limitTokens:number|null;exhausted:boolean;blocked:number}

const month=(d=new Date())=>d.toISOString().slice(0,7);
const num=(v:string|undefined)=>{const n=Number(v);return v!==undefined&&v.trim()!==""&&Number.isFinite(n)&&n>=0?n:null;};

export class CloudBudget{
  constructor(private readonly file:string|null,private readonly env:NodeJS.ProcessEnv=process.env){}
  static forStore(env:NodeJS.ProcessEnv=process.env):CloudBudget{
    return new CloudBudget(env.LAYANX_STORE_DIR?path.join(env.LAYANX_STORE_DIR,"cloud-usage.json"):null,env);
  }
  private memory:UsageFile={month:month(),providers:{}};
  private read():UsageFile{
    let data=this.memory;
    if(this.file){try{data=JSON.parse(fs.readFileSync(this.file,"utf8")) as UsageFile;}catch{data={month:month(),providers:{}};}}
    if(data.month!==month())data={month:month(),providers:{}};
    return data;
  }
  private write(data:UsageFile){
    this.memory=data;
    if(!this.file)return;
    try{fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+".tmp";fs.writeFileSync(tmp,JSON.stringify(data,null,1));fs.renameSync(tmp,this.file);}catch{}
  }
  /** Price per 1M tokens: the model's own price, else LAYANX_PRICE_<PROVIDER>_IN/_OUT, else unknown. */
  price(model:ModelDefinition):{input:number;output:number}|null{
    if(model.costPer1kInputUsd!==undefined||model.costPer1kOutputUsd!==undefined)return{input:(model.costPer1kInputUsd??0)*1000,output:(model.costPer1kOutputUsd??0)*1000};
    const key=model.provider.toUpperCase().replace(/[^A-Z0-9]/g,"_");
    const input=num(this.env[`LAYANX_PRICE_${key}_IN`]),output=num(this.env[`LAYANX_PRICE_${key}_OUT`]);
    return input===null&&output===null?null:{input:input??0,output:output??0};
  }
  /** Does this model count against the budget? */
  metered(model:ModelDefinition):boolean{
    if(model.local)return false;
    const p=this.price(model);
    return !(p&&p.input===0&&p.output===0);
  }
  status():BudgetStatus{
    const data=this.read();
    const all=Object.values(data.providers);
    const totalTokens=all.reduce((n,u)=>n+u.inputTokens+u.outputTokens,0);
    const totalCostUsd=Math.round(all.reduce((n,u)=>n+u.costUsd,0)*10000)/10000;
    const limitUsd=num(this.env.LAYANX_CLOUD_MONTHLY_BUDGET_USD),limitTokens=num(this.env.LAYANX_CLOUD_MONTHLY_TOKENS);
    const exhausted=(limitUsd!==null&&totalCostUsd>=limitUsd)||(limitTokens!==null&&totalTokens>=limitTokens);
    return{month:data.month,providers:data.providers,totalTokens,totalCostUsd,limitUsd,limitTokens,exhausted,blocked:data.blocked??0};
  }
  /** Called before a cloud call: false means "stay local". */
  allow(model:ModelDefinition):boolean{
    if(!this.metered(model))return true;
    if(!this.status().exhausted)return true;
    const data=this.read();data.blocked=(data.blocked??0)+1;this.write(data);
    return false;
  }
  record(model:ModelDefinition,response:ModelResponse,promptChars:number):void{
    if(!this.metered(model))return;
    const data=this.read();
    const u=data.providers[model.provider]??{calls:0,inputTokens:0,outputTokens:0,costUsd:0,priced:false};
    // Providers report tokens; when one does not, estimate about four characters per token.
    const input=response.usage?.inputTokens??Math.ceil(promptChars/4);
    const output=response.usage?.outputTokens??Math.ceil(response.output.length/4);
    u.calls++;u.inputTokens+=input;u.outputTokens+=output;
    const p=this.price(model);
    if(response.usage?.costUsd!==undefined){u.costUsd+=response.usage.costUsd;u.priced=true;}
    else if(p){u.costUsd+=(input*p.input+output*p.output)/1_000_000;u.priced=true;}
    data.providers[model.provider]=u;this.write(data);
  }
}
