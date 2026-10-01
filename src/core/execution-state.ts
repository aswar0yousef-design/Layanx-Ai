export interface ExecutionState{missionId:string;startedAt:string;toolCalls:number;runtimeMs:number;costUsd:number;status:"running"|"completed"|"blocked"|"failed";recoverable:boolean;}
export class ExecutionStateStore{
 private readonly states=new Map<string,ExecutionState>();
 start(missionId:string){const s={missionId,startedAt:new Date().toISOString(),toolCalls:0,runtimeMs:0,costUsd:0,status:"running" as const,recoverable:false};this.states.set(missionId,s);return s;}
 restore(state:ExecutionState){this.states.set(state.missionId,structuredClone(state));return this.states.get(state.missionId)!;}
 update(missionId:string,patch:Partial<ExecutionState>){const current=this.states.get(missionId);if(!current)throw new Error("Unknown execution state.");const next={...current,...patch};this.states.set(missionId,next);return next;}
 get(missionId:string){const state=this.states.get(missionId);return state?structuredClone(state):undefined;}
}