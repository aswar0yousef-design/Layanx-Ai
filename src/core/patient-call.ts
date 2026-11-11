/**
 * A local model that runs partly on the CPU sometimes misses the time limit, most often on the first call after it was
 * loaded from disk. Measured 2026-11-11: such a timeout handed csv work to a weaker 7B model, which then failed it.
 * One more try with the same model and a longer limit is cheaper than losing the strong model for the whole step.
 */
export const TIMED_OUT=/operation was aborted|aborterror|timed out|did not answer in time|timeout/i;
export function patientTimeoutMs(env:NodeJS.ProcessEnv=process.env):number{
  const base=Number(env.OLLAMA_TIMEOUT_MS)||180_000;
  const custom=Number(env.LAYANX_PATIENT_TIMEOUT_MS);
  return Number.isFinite(custom)&&custom>=base?custom:Math.max(300_000,Math.round(base*5/3));
}
export async function patientCall<T>(run:(timeoutMs?:number)=>Promise<T>,options:{env?:NodeJS.ProcessEnv;onRetry?:(error:Error,timeoutMs:number)=>void}={}):Promise<T>{
  try{return await run(undefined);}
  catch(error){
    const failure=error instanceof Error?error:new Error(String(error));
    const env=options.env??process.env;
    if(!TIMED_OUT.test(failure.message)||env.LAYANX_PATIENT_RETRY==="off")throw failure;
    const longer=patientTimeoutMs(env);
    options.onRetry?.(failure,longer);
    return run(longer);
  }
}
