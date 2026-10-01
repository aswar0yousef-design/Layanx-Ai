import type {ProviderHealth,ModelProvider,ProviderRegistry} from "./provider.js";
export class ProviderHealthMonitor{
 constructor(private readonly providers:ProviderRegistry){}
 async snapshot():Promise<ProviderHealth[]>{
  const results:ProviderHealth[]=[];
  for(const provider of this.providers.list())results.push(await provider.health());
  return results;
 }
 async healthy():Promise<ModelProvider[]>{
  const states=await this.snapshot();const ok=new Set(states.filter(s=>s.available).map(s=>s.provider));
  return this.providers.list().filter(p=>ok.has(p.name));
 }
}
