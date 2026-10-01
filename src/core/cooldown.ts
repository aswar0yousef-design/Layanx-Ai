export interface CooldownState{provider:string;failures:number;until:number;lastError?:string;}
export class CooldownManager{
 private readonly states=new Map<string,CooldownState>();
 constructor(private readonly baseMs=5000,private readonly maxMs=300000){}
 recordFailure(provider:string,error:string){
  const current=this.states.get(provider);const failures=(current?.failures??0)+1;
  const delay=Math.min(this.maxMs,this.baseMs*Math.pow(2,failures-1));
  this.states.set(provider,{provider,failures,until:Date.now()+delay,lastError:error});
 }
 recordSuccess(provider:string){this.states.delete(provider);}
 available(provider:string){const s=this.states.get(provider);return !s||s.until<=Date.now();}
 get(provider:string){return this.states.get(provider);}
}
