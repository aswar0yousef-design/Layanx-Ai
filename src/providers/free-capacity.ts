import {OpenAICompatibleProvider} from "../models/http-providers.js";
import type {ModelDefinition} from "../models/registry.js";
import type {ModelProviderAdapter,ModelRequest,ModelResponse} from "../models/inference.js";

export interface FreeCapacitySpec{
  name:string;
  baseUrl:string;
  apiKey?:string;
  apiKeyEnv?:string;
  models:string[];
  capabilities?:ModelDefinition["capabilities"];
  priority?:number;
  dailyTokenLimit?:number;
  monthlyTokenLimit?:number;
  cooldownMs?:number;
  tags?:string[];
}
type UsageWindow={inputTokens:number;outputTokens:number;resetAt:number};

export class FreeCapacityProvider implements ModelProviderAdapter{
  readonly name:string;
  private readonly delegate:OpenAICompatibleProvider;
  private readonly spec:FreeCapacitySpec;
  private daily:UsageWindow;
  private monthly:UsageWindow;
  private cooldownUntil=0;

  constructor(spec:FreeCapacitySpec,fetcher?:ConstructorParameters<typeof OpenAICompatibleProvider>[0]["fetcher"]){
    if(!spec.name||!spec.baseUrl||!spec.models.length)throw new Error("Free provider requires name, baseUrl, and at least one model.");
    this.name=spec.name;this.spec=spec;
    this.delegate=new OpenAICompatibleProvider({name:spec.name,baseUrl:spec.baseUrl,apiKey:spec.apiKey,fetcher});
    const now=Date.now();
    this.daily={inputTokens:0,outputTokens:0,resetAt:FreeCapacityProvider.nextDay(now)};
    this.monthly={inputTokens:0,outputTokens:0,resetAt:FreeCapacityProvider.nextMonth(now)};
  }
  private static nextDay(now:number){const d=new Date(now);d.setHours(24,0,0,0);return d.getTime();}
  private static nextMonth(now:number){const d=new Date(now);d.setMonth(d.getMonth()+1,1);d.setHours(0,0,0,0);return d.getTime();}
  private refresh(){const now=Date.now();if(now>=this.daily.resetAt)this.daily={inputTokens:0,outputTokens:0,resetAt:FreeCapacityProvider.nextDay(now)};if(now>=this.monthly.resetAt)this.monthly={inputTokens:0,outputTokens:0,resetAt:FreeCapacityProvider.nextMonth(now)};}
  private used(w:UsageWindow){return w.inputTokens+w.outputTokens;}
  private quotaAvailable(){this.refresh();if(this.spec.dailyTokenLimit!==undefined&&this.used(this.daily)>=this.spec.dailyTokenLimit)return false;if(this.spec.monthlyTokenLimit!==undefined&&this.used(this.monthly)>=this.spec.monthlyTokenLimit)return false;return Date.now()>=this.cooldownUntil;}
  async health(){
    if(!this.quotaAvailable()){this.refresh();const reason=Date.now()<this.cooldownUntil?"Provider cooldown active":"Configured free-token quota exhausted";return{provider:this.name,available:false,latencyMs:0,reason,updatedAt:new Date().toISOString()};}
    return this.delegate.health();
  }
  async generate(model:ModelDefinition,request:ModelRequest):Promise<ModelResponse>{
    if(!this.quotaAvailable())throw new Error(this.name+" free capacity unavailable.");
    try{
      const response=await this.delegate.generate(model,request);
      const input=response.usage?.inputTokens??0,output=response.usage?.outputTokens??0;
      this.daily.inputTokens+=input;this.daily.outputTokens+=output;this.monthly.inputTokens+=input;this.monthly.outputTokens+=output;
      return{...response,usage:{...response.usage,costUsd:0}};
    }catch(error){
      const message=error instanceof Error?error.message:"Provider request failed";
      if(/\b429\b|rate.?limit/i.test(message))this.cooldownUntil=Date.now()+(this.spec.cooldownMs??60000);
      throw error;
    }
  }
  status(){this.refresh();return{provider:this.name,dailyUsedTokens:this.used(this.daily),dailyLimit:this.spec.dailyTokenLimit??null,monthlyUsedTokens:this.used(this.monthly),monthlyLimit:this.spec.monthlyTokenLimit??null,cooldownUntil:this.cooldownUntil||null,models:[...this.spec.models]};}
}
