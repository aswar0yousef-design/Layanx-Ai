import type {LayanXCore} from "./core/orchestrator.js";
import type {ObservatorySnapshot} from "./core/observatory.js";

export interface ControlCenterSnapshot extends ObservatorySnapshot{
 generatedAt:string;
 missions:Array<{id:string;projectId?:string;goal:string;status:string;execution:unknown;nextAction:unknown}>;
 skills:unknown[];
 tools:unknown[];
}

export class ControlCenter{
 constructor(private readonly core:LayanXCore){}

 snapshot(projectId?:string):ControlCenterSnapshot{
  const missions=this.core.missions.list().filter(m=>!projectId||m.projectId===projectId);
  const execution=missions.map(m=>this.core.executionStates.get(m.id)).filter((x):x is NonNullable<typeof x>=>Boolean(x));
  const providers=this.core.providers.listHealth();
  const observatory=this.core.observatory.snapshot({
   missions:execution,
   agents:this.core.agents.list().length,
   providers,
   audit:missions.flatMap(m=>this.core.audit.forMission(m.id)).slice(-50),
   ledger:missions.flatMap(m=>this.core.ledger.forMission(m.id)).slice(-50)
  });
  return{
   ...observatory,
   generatedAt:new Date().toISOString(),
   missions:missions.map(mission=>({
    id:mission.id,projectId:mission.projectId,goal:mission.goal,status:mission.status,
    execution:this.core.executionStates.get(mission.id),
    nextAction:this.core.nextAction.decide({mission,tasks:this.core.delegation.forMission(mission.id),handoffs:this.core.handoffs.forMission(mission.id)})
   })),
   skills:this.core.skills.list().filter(skill=>!projectId||skill.status==="enabled"),
   tools:this.core.toolCatalog.list(this.core.agents.get("core"),"L1_READ")
  };
 }

 cancel(missionId:string,projectId:string):void{
  const mission=this.core.missions.get(missionId);
  if(!mission)throw new Error("Mission not found.");
  this.core.projectIsolation.assertMissionProject(projectId,mission.projectId);
  if(["completed","cancelled"].includes(mission.status))return;
  mission.status="cancelled";
  this.core.executionStates.update(mission.id,{status:"blocked",recoverable:false});
  this.core.audit.append({
   timestamp:new Date().toISOString(),actor:"control-center",action:"mission.cancel",
   resource:mission.id,result:"success",metadata:{missionId:mission.id,projectId}
  });
  this.core.missions.save(mission);
 }
}
