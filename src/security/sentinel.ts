export class Sentinel{
 private readonly blocked=new Set(["disable_security","exfiltrate_secret"]);
 inspect(action:string){return this.blocked.has(action)?{allowed:false,reason:"Sentinel blocked prohibited action."}:{allowed:true,reason:"Sentinel inspection passed."};}
}