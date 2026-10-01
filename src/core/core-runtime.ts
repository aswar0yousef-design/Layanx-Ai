import type {ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import {LayanXCore} from "./orchestrator.js";
import {MissionRunner} from "./mission-runner.js";

export interface CoreRunResult{ok:boolean;missionId:string;verified:boolean;decision:string;error?:string;data?:unknown;}

export class CoreRuntime{
 private readonly runner:MissionRunner;
 constructor(private readonly core:LayanXCore){this.runner=new MissionRunner(core);}
 async run(goal:string,request:Omit<ToolRequest,"missionId">,adapter:ToolAdapter):Promise<CoreRunResult>{
  const mission=this.core.startMission(goal);
  const risk=this.core.risk.assess({...request,missionId:mission.id});
  const decision=this.core.noAction.evaluate({risk:risk.level,hasRequiredApproval:false,budgetAvailable:true,goalRequiresAction:true});
  if(decision!=="execute")return{ok:false,missionId:mission.id,verified:false,decision,error:"Execution decision is "+decision};
  const result=await this.runner.execute(mission,{...request,missionId:mission.id},adapter);
  return{...result,decision};
 }
}
