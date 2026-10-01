export interface ExecutionState{missionId:string;startedAt:string;toolCalls:number;runtimeMs:number;costUsd:number;status:"running"|"completed"|"blocked"|"failed";}
export class ExecutionStateStore{
 private readonly states=new Map<string,ExecutionState>();
 start(missionId:string){const s={missionId,startedAt:new Date().toISOString(),toolCalls:0,runtimeMs:0,costUsd:0,status:"running" as const};this.states.set(missionId,s);return s;}
 update(missionId:string,patch:Partial<ExecutionState>){const current=this.states.get(missionId);if(!current)throw new Error("Unknown execution state.");const next={...current,...patch};this.states.set(missionId,next);return next;}
 get(missionId:string){return this.states.get(missionId);}
}
