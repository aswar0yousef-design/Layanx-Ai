export interface ProviderHealth{provider:string;available:boolean;latencyMs?:number;reason?:string;updatedAt:string;}
export interface ModelProvider{readonly name:string;health():Promise<ProviderHealth>;}
export class ProviderRegistry{
 private readonly providers=new Map<string,ModelProvider>();
 register(provider:ModelProvider){this.providers.set(provider.name,provider);}
 get(name:string){const p=this.providers.get(name);if(!p)throw new Error("Unknown provider: "+name);return p;}
 list(){return[...this.providers.values()];}
}
