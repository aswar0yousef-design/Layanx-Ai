export interface HttpHealthCheckOptions{
 name:string;
 url:string;
 timeoutMs?:number;
 expectedStatus?:number|number[];
 fetcher?:typeof fetch;
}

export function createHttpHealthCheck(options:HttpHealthCheckOptions):{name:string;check:()=>Promise<boolean>}{
 const expected=new Set(Array.isArray(options.expectedStatus)?options.expectedStatus:[options.expectedStatus??200]);
 const fetcher=options.fetcher??fetch;
 return{
  name:options.name,
  async check():Promise<boolean>{
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),Math.max(1,options.timeoutMs??5000));
   try{
    const response=await fetcher(options.url,{method:"GET",redirect:"error",signal:controller.signal});
    return expected.has(response.status);
   }finally{
    clearTimeout(timer);
   }
  }
 };
}
