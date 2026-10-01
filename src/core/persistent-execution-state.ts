import {JsonStateStore} from "./persistence.js";
import type {ExecutionState} from "./execution-state.js";

export class PersistentExecutionState{
  constructor(private readonly store:JsonStateStore<ExecutionState[]>){}
  async upsert(state:ExecutionState):Promise<void>{
    const current=await this.store.load()??[];
    const next=current.filter(x=>x.missionId!==state.missionId);
    next.push({...state});
    await this.store.save(next);
  }
  async get(missionId:string):Promise<ExecutionState|undefined>{
    return (await this.store.load()??[]).find(x=>x.missionId===missionId);
  }
  async list():Promise<ExecutionState[]>{return (await this.store.load())??[];}
}
