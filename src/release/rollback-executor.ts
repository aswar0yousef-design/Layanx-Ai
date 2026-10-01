import type {Deployment} from "./rollback.js";

export interface RollbackExecutionResult{
 success:boolean;
 deployment?:Deployment;
 reason?:string;
}

export interface RollbackExecutor{
 execute(target:Deployment):Promise<RollbackExecutionResult>;
}

export class InMemoryRollbackExecutor implements RollbackExecutor{
 private current?:Deployment;

 async execute(target:Deployment):Promise<RollbackExecutionResult>{
  this.current={...target};
  return{success:true,deployment:{...target}};
 }

 currentDeployment():Deployment|undefined{
  return this.current?{...this.current}:undefined;
 }
}
