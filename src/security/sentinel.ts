export class Sentinel{
 private readonly blocked=new Set(["disable_security","exfiltrate_secret","bypass_permission"]);
 inspect(action:string){if(this.blocked.has(action))return{allowed:false,reason:"Sentinel blocked prohibited action."};return{allowed:true,reason:"Sentinel inspection passed."};}
}