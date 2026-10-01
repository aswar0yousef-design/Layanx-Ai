import type {Mission,MissionStep} from "./types.js";
export class MissionPlanner{
 create(goal:string):Mission{
  const steps:MissionStep[]=[
   {id:crypto.randomUUID(),description:"Understand and normalize goal",status:"pending"},
   {id:crypto.randomUUID(),description:"Validate contract and permissions",status:"pending"},
   {id:crypto.randomUUID(),description:"Plan execution and verification",status:"pending"},
   {id:crypto.randomUUID(),description:"Execute with checkpoints and recovery",status:"pending"},
   {id:crypto.randomUUID(),description:"Verify and record result",status:"pending"}
  ];
  return{id:crypto.randomUUID(),goal,status:"planned",risk:"low",requiredPermission:"L1_READ",steps,createdAt:new Date().toISOString()};
 }
}