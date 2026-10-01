export interface Checkpoint{missionId:string;stepId:string;createdAt:string;state:unknown;}
export class RecoveryManager{
 private readonly checkpoints=new Map<string,Checkpoint>();
 checkpoint(c:Checkpoint){this.checkpoints.set(c.missionId,structuredClone(c));}
 restore(missionId:string){const c=this.checkpoints.get(missionId);return c?structuredClone(c):undefined;}
 restorePersisted(c:Checkpoint|undefined){if(c)this.checkpoint(c);}
 clear(missionId:string){this.checkpoints.delete(missionId);}
}
