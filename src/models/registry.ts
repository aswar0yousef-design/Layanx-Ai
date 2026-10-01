export type ModelCapability="chat"|"reasoning"|"coding"|"vision"|"embedding"|"audio";
export interface ModelDefinition{id:string;provider:string;capabilities:ModelCapability[];local:boolean;enabled:boolean;priority:number;}
export class ModelRegistry{
 private readonly models=new Map<string,ModelDefinition>();
 register(model:ModelDefinition){if(this.models.has(model.id))throw new Error("Model already registered.");this.models.set(model.id,model);}
 get(id:string){const m=this.models.get(id);if(!m)throw new Error("Unknown model: "+id);return m;}
 find(capability:ModelCapability){return [...this.models.values()].filter(m=>m.enabled&&m.capabilities.includes(capability)).sort((a,b)=>a.priority-b.priority);}
 list(){return[...this.models.values()];}
}
