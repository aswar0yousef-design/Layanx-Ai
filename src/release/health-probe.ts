export interface HealthCheck{ name:string; check:()=>Promise<boolean>; }
export class ReleaseHealthProbe{
 constructor(private readonly checks:HealthCheck[]){}
 async run(){const results=await Promise.all(this.checks.map(async c=>({name:c.name,healthy:await c.check()})));const failed=results.filter(r=>!r.healthy);return{healthy:failed.length===0,results,reason:failed.length?failed.map(x=>x.name+" failed.").join(" "):undefined};}
}
