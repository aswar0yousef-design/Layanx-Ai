export interface ProjectState{id:string;name:string;version:string;status:"active"|"paused"|"archived";updatedAt:string;metadata:Record<string,unknown>;}
export class ProjectStateStore{
 private readonly states=new Map<string,ProjectState>();
 upsert(state:ProjectState){this.states.set(state.id,{...state,updatedAt:new Date().toISOString()});}
 get(id:string){return this.states.get(id);}
 list(){return[...this.states.values()];}
}
