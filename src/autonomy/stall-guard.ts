/**
 * Notices work that has stopped moving. A job's time budget is only checked between steps, so one call that never
 * returns would hold a job forever. Every limit here is longer than the limit of whatever runs underneath it, so this
 * only fires when that inner limit failed too.
 */
export type StallKind="model"|"action";
export interface StallLimits{modelMs:number;actionMs:number;noProgressMs:number}

const positive=(value:string|undefined,fallback:number)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;};
/** A model request has 180 s and may be retried; the longest project task (install) has 15 minutes. */
export function stallLimits(env:NodeJS.ProcessEnv=process.env,override:Partial<StallLimits>={}):StallLimits{
  return{modelMs:positive(env.LAYANX_STALL_MODEL_MS,7*60_000),actionMs:positive(env.LAYANX_STALL_ACTION_MS,20*60_000),noProgressMs:positive(env.LAYANX_NO_PROGRESS_MS,30*60_000),...override};
}
export const describeDuration=(ms:number)=>ms>=60_000?`${Math.round(ms/6000)/10} min`:`${Math.round(ms/100)/10} s`;

/** "timed out" is what the model ladder reads as an unresponsive model. */
export class StallError extends Error{
  constructor(readonly what:string,readonly kind:StallKind,readonly limitMs:number){
    super(`timed out: ${what} made no progress for ${describeDuration(limitMs)}`);
    this.name="StallError";
  }
}

/** The clock restarts whenever activity() reports something newer: an agent that keeps working is not stalled. */
export function withStallLimit<T>(start:()=>Promise<T>,options:{what:string;kind:StallKind;limitMs:number;activity?:()=>number}):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    const began=Date.now();
    const timer=setInterval(()=>{
      const last=Math.max(began,options.activity?.()??0);
      if(Date.now()-last<options.limitMs)return;
      clearInterval(timer);
      reject(new StallError(options.what,options.kind,options.limitMs));
    },Math.max(Math.min(options.limitMs/4,15_000),5));
    timer.unref?.();
    const settle=(finish:()=>void)=>{clearInterval(timer);finish();};
    let running:Promise<T>;
    try{running=Promise.resolve(start());}catch(error){settle(()=>reject(error));return;}
    running.then(value=>settle(()=>resolve(value)),error=>settle(()=>reject(error)));
  });
}
