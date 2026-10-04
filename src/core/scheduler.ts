import type {LayanXCore} from "./orchestrator.js";
import type {RuntimeStorage} from "../storage/runtime-storage.js";

export type ScheduleTrigger={
  kind:"interval"|"once"|"daily";
  intervalMs?:number;
  runAt?:string;
  runImmediately?:boolean;
};
export interface ScheduledMission{
  id:string;
  goal:string;
  projectId:string;
  trigger:ScheduleTrigger;
  maxSteps?:number;
  agentId?:string;
  enabled:boolean;
  createdAt:string;
  lastRunAt?:string;
  nextRunAt?:string;
  runCount:number;
};
export interface SchedulerRun{scheduleId:string;missionId?:string;startedAt:string;completedAt?:string;status:"running"|"completed"|"failed"|"skipped";error?:string;}

export class MissionScheduler{
 private readonly schedules=new Map<string,ScheduledMission>();
 private readonly runs=new Map<string,SchedulerRun>();
 private timer?:ReturnType<typeof setInterval>;
 private readonly active=new Set<string>();
 constructor(private readonly core:LayanXCore,private readonly storage?:RuntimeStorage,private readonly tickMs=1000){}

 register(input:Omit<ScheduledMission,"id"|"createdAt"|"runCount"|"enabled"> & {enabled?:boolean}):ScheduledMission{
  if(!input.goal.trim())throw new Error("Scheduled mission goal is empty.");
  const projectId=this.core.projectIsolation.normalize(input.projectId);
  this.validateTrigger(input.trigger);
  const now=new Date().toISOString();
  const next=this.nextTime(input.trigger,new Date());
  const schedule={...input,id:crypto.randomUUID(),projectId,createdAt:now,runCount:0,enabled:input.enabled??true,nextRunAt:next?.toISOString()};
  this.schedules.set(schedule.id,schedule);this.persist();
  this.core.audit.append({timestamp:now,actor:"scheduler",action:"schedule.create",resource:schedule.id,result:"success",metadata:{projectId,goal:schedule.goal,trigger:schedule.trigger}});
  return structuredClone(schedule);
 }
 unregister(id:string){const schedule=this.schedules.get(id);if(!schedule)throw new Error("Unknown schedule.");this.schedules.delete(id);this.persist();this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.delete",resource:id,result:"success"});}
 setEnabled(id:string,enabled:boolean){const schedule=this.require(id);schedule.enabled=enabled;schedule.nextRunAt=enabled?this.nextTime(schedule.trigger,new Date())?.toISOString():undefined;this.persist();this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.toggle",resource:id,result:"success",metadata:{enabled}});return structuredClone(schedule);}
 list(){return [...this.schedules.values()].map(item=>structuredClone(item));}
 get(id:string){const schedule=this.schedules.get(id);return schedule?structuredClone(schedule):undefined;}
 async hydrate(){if(!this.storage)return;const saved=await this.storage.get<ScheduledMission[]>("scheduler:schedules");if(saved){this.schedules.clear();for(const item of saved)this.schedules.set(item.id,item);}}
 private persist(){if(this.storage)void this.storage.set([...this.schedules.values()].map(item=>structuredClone(item)),"scheduler:schedules");}
 start(){if(this.timer)return;this.timer=setInterval(()=>void this.tick(),this.tickMs);this.timer.unref?.();void this.tick();}
 stop(){if(this.timer){clearInterval(this.timer);this.timer=undefined;}}
 async tick(now=new Date()):Promise<SchedulerRun[]>{
  const due=[...this.schedules.values()].filter(s=>s.enabled&&s.nextRunAt&&new Date(s.nextRunAt).getTime()<=now.getTime()&&!this.active.has(s.id));
  return Promise.all(due.map(schedule=>this.run(schedule,now)));
 }
 private async run(schedule:ScheduledMission,now:Date):Promise<SchedulerRun>{
  const run:SchedulerRun={scheduleId:schedule.id,startedAt:now.toISOString(),status:"running"};
  if(this.active.has(schedule.id)){run.status="skipped";run.completedAt=new Date().toISOString();return run;}
  this.active.add(schedule.id);this.runs.set(schedule.id,run);
  schedule.lastRunAt=now.toISOString();schedule.runCount+=1;
  schedule.nextRunAt=this.nextTime(schedule.trigger,new Date(now.getTime()+1))?.toISOString();this.persist();
  try{
   const result=await this.core.runAgentGateway(schedule.goal,schedule.projectId,schedule.maxSteps??10,{},schedule.agentId??"core");
   run.missionId=result.missionId;run.status=result.completed?"completed":"failed";
   if(!result.completed)run.error=typeof result.reason==="string"?result.reason:"Scheduled mission did not complete.";
   this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.run",resource:schedule.id,result:result.completed?"success":"failure",metadata:{scheduleId:schedule.id,missionId:result.missionId,projectId:schedule.projectId,runCount:schedule.runCount}});
  }catch(error){run.status="failed";run.error=error instanceof Error?error.message:"Scheduled mission failed.";this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.run",resource:schedule.id,result:"failure",metadata:{scheduleId:schedule.id,projectId:schedule.projectId,error:run.error}});}
  finally{run.completedAt=new Date().toISOString();this.active.delete(schedule.id);this.runs.set(schedule.id,structuredClone(run));}
  return structuredClone(run);
 }
 private require(id:string){const schedule=this.schedules.get(id);if(!schedule)throw new Error("Unknown schedule.");return schedule;}
 private validateTrigger(trigger:ScheduleTrigger){
  if(trigger.kind==="interval"){const intervalMs=trigger.intervalMs;if(intervalMs===undefined||!Number.isFinite(intervalMs)||!Number.isInteger(intervalMs)||intervalMs<1000)throw new Error("Interval must be an integer of at least 1000ms.");return;}
  if(trigger.kind==="once"){if(!trigger.runAt||Number.isNaN(Date.parse(trigger.runAt)))throw new Error("A valid runAt timestamp is required.");return;}
  if(trigger.kind==="daily"){if(!Number.isInteger(trigger.hour)||trigger.hour<0||trigger.hour>23||!Number.isInteger(trigger.minute)||trigger.minute<0||trigger.minute>59)throw new Error("Daily trigger requires hour 0-23 and minute 0-59.");return;}
  throw new Error("Unknown schedule trigger.");
 }
 private nextTime(trigger:ScheduleTrigger,from:Date){
  if(trigger.kind==="once"){const at=new Date(trigger.runAt!);return at.getTime()>=from.getTime()?at:undefined;}
  if(trigger.kind==="daily"){const next=new Date(from);next.setHours(trigger.hour,trigger.minute,0,0);if(next.getTime()<from.getTime())next.setDate(next.getDate()+1);return next;}
  const intervalMs=trigger.intervalMs;
  if(typeof intervalMs!=="number"||!Number.isFinite(intervalMs))throw new Error("Interval trigger is missing intervalMs.");
  const delayMs=trigger.runImmediately===true?0:intervalMs;
  return new Date(from.getTime()+delayMs);
 }
}