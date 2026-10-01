import type {AgentContract} from "./contracts.js";
import type {DelegatedTask,DelegationManager} from "./delegation.js";

export interface TeamExecutionResult{completed:string[];failed:string[];repaired:string[];blocked:string[];}
export interface TeamTaskExecutor{
 execute(task:DelegatedTask,agent:AgentContract):Promise<{ok:boolean;error?:string}>;
 repair?(task:DelegatedTask,agent:AgentContract,error:string):Promise<boolean>;
}

export class AgentTeamRuntime{
 constructor(private readonly delegation:DelegationManager,private readonly agents:{get(id:string):AgentContract},private readonly isolate:{assertMissionProject(projectId:string,missionProjectId:string|undefined):void}){}

 async run(parentMissionId:string,projectId:string,missionProjectId:string|undefined,tasks:DelegatedTask[],executor:TeamTaskExecutor,maxRepairs=1):Promise<TeamExecutionResult>{
  this.isolate.assertMissionProject(projectId,missionProjectId);
  if(maxRepairs<0||maxRepairs>1)throw new Error("Team repair attempts must be between 0 and 1.");
  const pending=new Set(tasks.map(task=>task.id));
  const completed:string[]=[];const failed:string[]=[];const repaired:string[]=[];const blocked:string[]=[];
  const attempts=new Map<string,number>();

  while(pending.size){
   let progressed=false;
   for(const id of [...pending]){
    const task=this.delegation.get(id);
    if(task.parentMissionId!==parentMissionId){pending.delete(id);blocked.push(id);progressed=true;continue;}
    const dependencies=task.dependsOn;
    const unresolved=dependencies.filter(dep=>!completed.includes(dep));
    const failedDependency=dependencies.some(dep=>failed.includes(dep)||blocked.includes(dep));
    if(failedDependency){pending.delete(id);blocked.push(id);progressed=true;continue;}
    if(unresolved.length)continue;
    const agent=this.agents.get(task.agentId);
    this.delegation.start(id);
    const result=await executor.execute(task,agent);
    if(result.ok){
     this.delegation.complete(id);completed.push(id);pending.delete(id);progressed=true;continue;
    }
    const used=attempts.get(id)??0;
    if(executor.repair&&used<maxRepairs){
     attempts.set(id,used+1);
     const repairedOk=await executor.repair(task,agent,result.error??"task failed");
     if(repairedOk){
      repaired.push(id);
      const retry=await executor.execute(task,agent);
      if(retry.ok){this.delegation.complete(id);completed.push(id);pending.delete(id);progressed=true;continue;}
     }
    }
    this.delegation.fail(id);failed.push(id);pending.delete(id);progressed=true;
   }
   if(!progressed){
    for(const id of pending){this.delegation.fail(id);blocked.push(id);}
    break;
   }
  }
  return{completed,failed,repaired,blocked};
 }
}
