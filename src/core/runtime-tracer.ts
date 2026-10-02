export type TraceStatus="running"|"success"|"failure"|"blocked";

export interface TraceSpan{
  traceId:string; spanId:string; parentSpanId?:string;
  name:string; kind:"mission"|"task"|"agent"|"model"|"tool"|"test"|"repair"|"git"|"release";
  startedAt:string; endedAt?:string; durationMs?:number; status:TraceStatus;
  attributes:Record<string,unknown>;
}

export class RuntimeTracer{
  private readonly spans=new Map<string,TraceSpan[]>();

  start(name:string,kind:TraceSpan["kind"],attributes:Record<string,unknown>={},traceId=crypto.randomUUID(),parentSpanId?:string){
    const spanId=crypto.randomUUID();
    const span:TraceSpan={traceId,spanId,parentSpanId,name,kind,startedAt:new Date().toISOString(),status:"running",attributes:this.sanitize(attributes)};
    const list=this.spans.get(traceId)??[];list.push(span);this.spans.set(traceId,list);return span;
  }

  end(span:TraceSpan,status:TraceStatus,attributes:Record<string,unknown>={}){
    const list=this.spans.get(span.traceId);if(!list)throw new Error("Unknown trace.");
    const current=list.find(item=>item.spanId===span.spanId);if(!current)throw new Error("Unknown span.");
    current.endedAt=new Date().toISOString();
    current.durationMs=Math.max(0,Date.parse(current.endedAt)-Date.parse(current.startedAt));
    current.status=status;
    current.attributes={...current.attributes,...this.sanitize(attributes)};
    return structuredClone(current);
  }

  get(traceId:string){return structuredClone(this.spans.get(traceId)??[]);}
  list(){return [...this.spans.entries()].map(([traceId,spans])=>({traceId,spans:structuredClone(spans)}));}
  clear(traceId?:string){if(traceId)this.spans.delete(traceId);else this.spans.clear();}

  private sanitize(attributes:Record<string,unknown>){
    const out:Record<string,unknown>={};
    for(const [key,value] of Object.entries(attributes)){
      if(/api[_-]?key|secret|password|token|authorization|private[_-]?key|credential/i.test(key))out[key]="[REDACTED]";
      else if(typeof value==="string")out[key]=value.replace(/bearer\s+[A-Za-z0-9._-]{8,}/gi,"[REDACTED]");
      else out[key]=value;
    }
    return out;
  }
}
