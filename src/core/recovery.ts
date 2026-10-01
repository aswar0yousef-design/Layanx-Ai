export interface Checkpoint{missionId:string;stepId:string;createdAt:string;state:unknown;}
export class RecoveryManager{
 private readonly checkpoints=new Map<string,Checkpoint>();
 checkpoint(c:Checkpoint){this.checkpoints.set(c.missionId,c);}
 restore(missionId:string){return this.checkpoints.get(missionId);}
 clear(missionId:string){this.checkpoints.delete(missionId);}
}
