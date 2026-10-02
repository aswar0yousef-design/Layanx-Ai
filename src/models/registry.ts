export type ModelCapability="chat"|"reasoning"|"coding"|"vision"|"embedding"|"audio";
export interface ModelDefinition{id:string;provider:string;capabilities:ModelCapability[];local:boolean;enabled:boolean;priority:number;qualityScore?:number;costPer1kInputUsd?:number;costPer1kOutputUsd?:number;latencyClass?:"fast"|"balanced"|"slow";tags?:string[];}
export interface ModelSelectionRequest{capability:ModelCapability;modelId?:string;preferLocal?:boolean;latencySensitive?:boolean;maxCostUsd?:number;minQualityScore?:number;tags?:string[];}
export class ModelRegistry{
 private readonly models=new Map<string,ModelDefinition>();
 register(model:ModelDefinition){if(this.models.has(model.id))throw new Error("Model already registered.");this.models.set(model.id,model);}
 get(id:string){const m=this.models.get(id);if(!m)throw new Error("Unknown model: "+id);return m;}
 find(capability:ModelCapability){return[...this.models.values()].filter(m=>m.enabled&&m.capabilities.includes(capability)).sort((a,b)=>a.priority-b.priority);}
 select(request:ModelSelectionRequest){
  const candidates=this.find(request.capability).filter(model=>{
   if(request.modelId!==undefined&&model.id!==request.modelId)return false;
   if(request.minQualityScore!==undefined&&(model.qualityScore??0)<request.minQualityScore)return false;
   if(request.maxCostUsd!==undefined&&(model.costPer1kInputUsd??0)+(model.costPer1kOutputUsd??0)>request.maxCostUsd)return false;
   return true;
  });
  if(!candidates.length)throw new Error("No enabled model matches routing constraints.");
  const tags=new Set(request.tags??[]);
  return[...candidates].sort((a,b)=>this.score(b,request,tags)-this.score(a,request,tags)||a.priority-b.priority);
 }
 private score(model:ModelDefinition,request:ModelSelectionRequest,tags:Set<string>){
  let score=100-model.priority;
  if(request.preferLocal===true&&model.local)score+=25;
  if(request.preferLocal===false&&!model.local)score+=10;
  if(request.latencySensitive){if(model.latencyClass==="fast")score+=20;if(model.latencyClass==="slow")score-=10;}
  score+=(model.qualityScore??50)*0.2;
  if(tags.size&&model.tags)for(const tag of model.tags)if(tags.has(tag))score+=8;
  return score;
 }
 list(){return[...this.models.values()];}
}