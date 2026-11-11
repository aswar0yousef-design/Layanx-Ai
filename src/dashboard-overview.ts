import type {ModelUsage} from "./core/model-stats.js";

interface OverviewModel{id:string;provider:string;local?:boolean;enabled?:boolean}
interface OverviewInput{
  models:OverviewModel[];usage:ModelUsage[];
  /** null means the provider's price is not known, so its cost is not known either. */
  price:(model:OverviewModel)=>{input:number;output:number}|null;
  cloud:{month:string;totalCostUsd:number;limitUsd:number|null;exhausted:boolean};
  tools:Array<{permission?:string}>;
  connections:Array<{provider?:string;status?:string;connected?:boolean}>;
  jobs:Array<{goal:string;status:string;projectId:string;createdAt?:string}>;
  audit:Array<{timestamp:string;action:string;resource?:string;result?:string}>;
}
/** One view of the system, built from what was recorded. A number nobody measured stays empty instead of showing zero. */
export function dashboardOverview(input:OverviewInput){
  const usageById=new Map(input.usage.map(row=>[row.modelId,row]));
  const known=new Map(input.models.map(model=>[model.id,model]));
  const ids=[...new Set([...input.usage.map(row=>row.modelId),...input.models.filter(model=>model.enabled!==false).map(model=>model.id)])];
  const models=ids.map(id=>{
    const model=known.get(id),row=usageById.get(id);
    const price=model?.local?{input:0,output:0}:model?input.price(model):null;
    const tokens=row?row.inputTokens+row.outputTokens:0;
    const costUsd=!row?0:price?Math.round((row.inputTokens*price.input+row.outputTokens*price.output)/1e6*10000)/10000:null;
    return{id,provider:model?.provider??row?.provider??"",local:Boolean(model?.local),enabled:model?.enabled!==false&&Boolean(model),calls:row?.calls??0,ok:row?.ok??0,failed:row?.failed??0,
      averageMs:row?.ok||row?.failed?Math.round(row.totalMs/row.calls):null,tokens,costUsd,lastUsedAt:row?.lastUsedAt??null,lastError:row?.lastError??null};
  }).sort((a,b)=>b.calls-a.calls||a.id.localeCompare(b.id));
  const byStatus:Record<string,number>={};
  for(const job of input.jobs)byStatus[job.status]=(byStatus[job.status]??0)+1;
  const failures=input.audit.filter(event=>event.result&&!["success","ok","allowed","started"].includes(event.result)).slice(-20).reverse()
    .map(event=>({at:event.timestamp,action:event.action,resource:String(event.resource??"").slice(0,120),result:event.result}));
  const modelErrors=models.filter(model=>model.lastError).map(model=>({model:model.id,error:model.lastError}));
  return{
    generatedAt:new Date().toISOString(),
    totals:{modelCalls:models.reduce((n,m)=>n+m.calls,0),modelFailures:models.reduce((n,m)=>n+m.failed,0),tokens:models.reduce((n,m)=>n+m.tokens,0),
      costUsd:models.some(m=>m.costUsd===null&&m.calls>0)?null:Math.round(models.reduce((n,m)=>n+(m.costUsd??0),0)*10000)/10000},
    models,cloud:input.cloud,
    tools:{total:input.tools.length,byPermission:input.tools.reduce<Record<string,number>>((all,tool)=>{const key=tool.permission??"unknown";all[key]=(all[key]??0)+1;return all;},{})},
    connections:input.connections.map(c=>({provider:c.provider??"",connected:c.connected??c.status==="connected",status:c.status??""})),
    jobs:{byStatus,recent:input.jobs.slice(0,8).map(job=>({goal:job.goal.split("\n")[0]!.slice(0,100),status:job.status,projectId:job.projectId}))},
    errors:{failures,modelErrors}
  };
}
