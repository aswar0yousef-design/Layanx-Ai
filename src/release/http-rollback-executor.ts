import type {Deployment} from "./rollback.js";
import type {RollbackExecutionResult,RollbackExecutor} from "./rollback-executor.js";

export interface HttpRollbackExecutorOptions{
 endpoint:string;
 timeoutMs?:number;
 fetcher?:typeof fetch;
 headers?:Record<string,string>;
}

export class HttpRollbackExecutor implements RollbackExecutor{
 private readonly fetcher:typeof fetch;
 constructor(private readonly options:HttpRollbackExecutorOptions){
  this.fetcher=options.fetcher??fetch;
 }

 async execute(target:Deployment):Promise<RollbackExecutionResult>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1,this.options.timeoutMs??10000));
  try{
   const response=await this.fetcher(this.options.endpoint,{
    method:"POST",
    headers:{"content-type":"application/json",...(this.options.headers??{})},
    body:JSON.stringify({deployment:target}),
    redirect:"error",
    signal:controller.signal
   });
   if(!response.ok){
    return{success:false,reason:"Rollback provider returned HTTP "+response.status+"."};
   }
   return{success:true,deployment:{...target}};
  }catch(error){
   return{success:false,reason:error instanceof Error?error.message:"Rollback provider request failed."};
  }finally{
   clearTimeout(timer);
  }
 }
}
