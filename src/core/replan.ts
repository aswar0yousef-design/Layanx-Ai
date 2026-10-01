import type {Mission} from "./types.js";
export interface ReplanReason{code:string;message:string;recoverable:boolean;}
export class Replanner{
 shouldReplan(reason:ReplanReason){return reason.recoverable;}
 replan(mission:Mission,reason:ReplanReason):Mission{
  if(!reason.recoverable)return mission;
  return {...mission,status:"planned",steps:mission.steps.map(s=>s.status==="failed"?{...s,status:"pending"}:s)};
 }
}
