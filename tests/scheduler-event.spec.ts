import {MissionScheduler} from "../src/core/scheduler.js";
import {EventMissionEngine} from "../src/core/event-engine.js";

const calls:string[]=[];
const core={projectIsolation:{normalize:(id:string)=>id},audit:{append:(e:any)=>calls.push(e.action+":"+e.resource)},runAgentGateway:async(goal:string,projectId:string)=>{calls.push("run:"+goal.split("\n")[0]+":"+projectId);return{missionId:"m-"+calls.length,completed:true};}} as any;
const scheduler=new MissionScheduler(core,1000);
const schedule=scheduler.register({goal:"scheduled job",projectId:"p",trigger:{kind:"once",runAt:new Date(Date.now()+10).toISOString()}});
if(!schedule.enabled||!schedule.nextRunAt)throw new Error("Schedule registration failed.");
await scheduler.tick(new Date(Date.now()+100));
if(!calls.some(x=>x.startsWith("run:scheduled job:p")))throw new Error("Scheduled mission did not run.");

const engine=new EventMissionEngine(core);
engine.register({eventType:"deployment.completed",projectId:"p",goal:"verify deployment",match:{environment:"production"}});
const results=await engine.emit({id:"e1",type:"deployment.completed",projectId:"p",timestamp:new Date().toISOString(),payload:{environment:"production"}});
if(results.length!==1||!calls.some(x=>x.startsWith("run:verify deployment:p")))throw new Error("Event mission did not run.");
const ignored=await engine.emit({id:"e2",type:"deployment.completed",projectId:"p",timestamp:new Date().toISOString(),payload:{environment:"staging"}});
if(ignored.length!==0)throw new Error("Event matcher ignored payload constraints.");
console.log("Scheduler and event mission tests passed.");