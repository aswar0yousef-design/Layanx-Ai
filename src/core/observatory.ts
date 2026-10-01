import type {ExecutionState} from "./execution-state.js";
import type {AuditEvent} from "./audit.js";
import type {LedgerEntry} from "./ledger.js";
import type {ProviderHealth} from "./provider.js";
export interface ObservatorySnapshot{
 timestamp:string;
 missions:{total:number;running:number;completed:number;failed:number;blocked:number};
 agents:{total:number};
 providers:{total:number;healthy:number;degraded:number};
 execution:{active:number;toolCalls:number;runtimeMs:number;costUsd:number};
 recentAudit:AuditEvent[];
 recentLedger:LedgerEntry[];
}
export class MissionObservatory{
 snapshot(input:{missions:ExecutionState[];agents:number;providers:ProviderHealth[];audit:AuditEvent[];ledger:LedgerEntry[]}):ObservatorySnapshot{
  const m=input.missions;
  return{
   timestamp:new Date().toISOString(),
   missions:{total:m.length,running:m.filter(x=>x.status==="running").length,completed:m.filter(x=>x.status==="completed").length,failed:m.filter(x=>x.status==="failed").length,blocked:m.filter(x=>x.status==="blocked").length},
   agents:{total:input.agents},
   providers:{total:input.providers.length,healthy:input.providers.filter(x=>x.available).length,degraded:input.providers.filter(x=>!x.available).length},
   execution:{active:m.filter(x=>x.status==="running").length,toolCalls:m.reduce((n,x)=>n+x.toolCalls,0),runtimeMs:m.reduce((n,x)=>n+x.runtimeMs,0),costUsd:m.reduce((n,x)=>n+x.costUsd,0)},
   recentAudit:input.audit.slice(-20),
   recentLedger:input.ledger.slice(-20)
  };
 }
}
