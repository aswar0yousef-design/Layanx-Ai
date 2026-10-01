export interface HealthCheck{ name:string; check:()=>Promise<boolean>; }
export interface HealthProbeResult{healthy:boolean;results:Array<{name:string;healthy:boolean}>;reason?:string;}
export class ReleaseHealthProbe{
 constructor(private readonly checks:HealthCheck[]){}
 async run():Promise<HealthProbeResult>{
  const results=await Promise.all(this.checks.map(async c=>{
   try{return{name:c.name,healthy:await c.check()};}
   catch{return{name:c.name,healthy:false};}
  }));
  const failed=results.filter(r=>!r.healthy);
  return{healthy:failed.length===0,results,reason:failed.length?failed.map(x=>x.name+" failed.").join(" "):undefined};
 }
}
