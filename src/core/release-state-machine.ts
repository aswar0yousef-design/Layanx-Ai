export type ReleaseStage="DRAFT"|"REVIEWED"|"SECURITY_APPROVED"|"PR_READY"|"HUMAN_APPROVAL"|"MERGE_ALLOWED"|"RELEASE_CANDIDATE"|"RELEASE_APPROVED"|"RELEASED"|"BLOCKED";

export interface ReleaseRecord{
  id:string; missionId:string; projectId:string; stage:ReleaseStage;
  branch:string; baseBranch:string; commit:string; title:string; createdAt:string; updatedAt:string;
  blockers:string[];
}

const allowed:Record<ReleaseStage,ReleaseStage[]>={
 DRAFT:["REVIEWED","BLOCKED"], REVIEWED:["SECURITY_APPROVED","BLOCKED"],
 SECURITY_APPROVED:["PR_READY","BLOCKED"], PR_READY:["HUMAN_APPROVAL","BLOCKED"],
 HUMAN_APPROVAL:["MERGE_ALLOWED","BLOCKED"], MERGE_ALLOWED:["RELEASE_CANDIDATE","BLOCKED"],
 RELEASE_CANDIDATE:["RELEASE_APPROVED","BLOCKED"], RELEASE_APPROVED:["RELEASED","BLOCKED"],
 RELEASED:[], BLOCKED:["DRAFT"]
};

export class ReleaseStateMachine{
 private readonly records=new Map<string,ReleaseRecord>();
 create(input:Omit<ReleaseRecord,"stage"|"createdAt"|"updatedAt"|"blockers">){
  const now=new Date().toISOString(); const record:ReleaseRecord={...input,stage:"DRAFT",createdAt:now,updatedAt:now,blockers:[]};
  this.records.set(record.id,record); return structuredClone(record);
 }
 get(id:string){const r=this.records.get(id);return r?structuredClone(r):undefined;}
 list(){return [...this.records.values()].map(r=>structuredClone(r));}
 transition(id:string,next:ReleaseStage,blockers:string[]=[]){
  const r=this.records.get(id); if(!r)throw new Error("Release record not found.");
  if(!allowed[r.stage].includes(next))throw new Error("Invalid release transition: "+r.stage+" -> "+next);
  if(next!=="BLOCKED"&&blockers.length)throw new Error("Cannot enter "+next+" while blockers exist.");
  r.stage=next;r.blockers=[...blockers];r.updatedAt=new Date().toISOString();return structuredClone(r);
 }
 block(id:string,reason:string){return this.transition(id,"BLOCKED",[reason]);}
}
