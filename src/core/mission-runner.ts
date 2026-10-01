import type {Mission,ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import {ExecutionRuntime} from "./runtime.js";
import {Replanner} from "./replan.js";
import type {RuntimeSecurityContext} from "./runtime.js";

export class MissionRunner{
 private readonly runtime:ExecutionRuntime;
 private readonly replanner=new Replanner();
 constructor(private readonly core:ConstructorParameters<typeof ExecutionRuntime>[0]){this.runtime=new ExecutionRuntime(core);}
 async execute(mission:Mission,request:ToolRequest,adapter:ToolAdapter,approvalId?:string,security?:RuntimeSecurityContext){
  let current=mission;
  for(let attempt=0;attempt<2;attempt++){
   const result=await this.runtime.run(current,request,adapter,approvalId,security);
   if(result.ok)return result;
   if(!result.recoverable)return result;
   const replanned=this.replanner.replan(current,{code:"EXECUTION_FAILURE",message:result.error??"Execution failed",recoverable:true});
   if(replanned===current)return result;
   current=replanned;
  }
  return{ok:false,missionId:mission.id,verified:false,error:"Mission failed after recovery attempt.",recoverable:false};
 }
}
