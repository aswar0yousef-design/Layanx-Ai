import type {Mission,MissionStatus} from "./types.js";
import type {LayanXCore} from "./orchestrator.js";

export type MissionDependencyState="pending"|"ready"|"blocked"|"completed"|"failed";

export interface MissionDependency{
  missionId:string;
  dependsOn:string[];
  projectId:string;
  createdAt:string;
}

export interface MissionDependencySnapshot{
  missionId:string;
  projectId:string;
  dependsOn:string[];
  state:MissionDependencyState;
  blockedBy:string[];
  completedDependencies:string[];
  failedDependencies:string[];
  pendingDependencies:string[];
}

export class MissionDependencyManager{
  private readonly dependencies=new Map<string,MissionDependency>();
  constructor(private readonly core:LayanXCore){}

  register(missionId:string,dependsOn:string[],projectId:string):MissionDependency{
    const mission=this.requireMission(missionId);
    const normalized=this.core.projectIsolation.normalize(projectId);
    this.core.projectIsolation.assertMissionProject(normalized,mission.projectId);
    const unique=[...new Set(dependsOn.filter(Boolean))];
    for(const dependencyId of unique){
      if(dependencyId===missionId)throw new Error("Mission cannot depend on itself.");
      const dependency=this.requireMission(dependencyId);
      this.core.projectIsolation.assertMissionProject(normalized,dependency.projectId);
    }
    this.assertNoCycle(missionId,unique);
    const record:MissionDependency={missionId,dependsOn:unique,projectId:normalized,createdAt:new Date().toISOString()};
    this.dependencies.set(missionId,record);
    this.core.audit.append({timestamp:new Date().toISOString(),actor:"mission-dependency",action:"mission.dependency.register",resource:missionId,result:"success",metadata:{projectId:normalized,dependsOn:unique}});
    this.core.memory.remember({missionId,projectId:normalized,kind:"decision",summary:"Mission dependencies registered",content:{missionId,dependsOn:unique},confidence:1,tags:["mission","dependency"]});
    return structuredClone(record);
  }

  remove(missionId:string){this.dependencies.delete(missionId);}

  get(missionId:string):MissionDependency|undefined{
    const value=this.dependencies.get(missionId);
    return value?structuredClone(value):undefined;
  }

  list(projectId?:string){
    return [...this.dependencies.values()]
      .filter(item=>!projectId||item.projectId===this.core.projectIsolation.normalize(projectId))
      .map(item=>structuredClone(item));
  }

  status(missionId:string):MissionDependencySnapshot{
    const record=this.dependencies.get(missionId);
    const dependsOn=record?.dependsOn??[];
    const missions=dependsOn.map(id=>this.requireMission(id));
    const completedDependencies=missions.filter(m=>m.status==="completed").map(m=>m.id);
    const failedDependencies=missions.filter(m=>["failed","cancelled"].includes(m.status)).map(m=>m.id);
    const pendingDependencies=missions.filter(m=>!["completed","failed","cancelled"].includes(m.status)).map(m=>m.id);
    const state:MissionDependencyState=
      failedDependencies.length?"failed":
      pendingDependencies.length?"pending":
      dependsOn.length?"completed":"ready";
    return{missionId,projectId:record?.projectId??this.core.projectIsolation.normalize(this.requireMission(missionId).projectId??"default"),dependsOn,state,blockedBy:failedDependencies,completedDependencies,failedDependencies,pendingDependencies};
  }

  assertReady(missionId:string){
    const snapshot=this.status(missionId);
    if(snapshot.failedDependencies.length)throw new Error("Mission dependency failed: "+snapshot.failedDependencies.join(", "));
    if(snapshot.pendingDependencies.length)throw new Error("Mission dependencies are not completed: "+snapshot.pendingDependencies.join(", "));
    return snapshot;
  }

  async runWhenReady(missionId:string,projectId:string,maxSteps=10,agentId="core"){
    const normalized=this.core.projectIsolation.normalize(projectId);
    const mission=this.requireMission(missionId);
    this.core.projectIsolation.assertMissionProject(normalized,mission.projectId);
    const snapshot=this.assertReady(missionId);
    if(mission.status==="completed")return{missionId,completed:true,reason:"Mission is already completed.",dependencies:snapshot};
    if(["failed","cancelled"].includes(mission.status))return{missionId,completed:false,reason:"Mission is terminal.",dependencies:snapshot};
    const result=await this.core.runAgentGateway(mission.goal,normalized,maxSteps,{},agentId);
    this.core.audit.append({timestamp:new Date().toISOString(),actor:"mission-dependency",action:"mission.dependency.run",resource:missionId,result:result.completed?"success":"failure",metadata:{projectId:normalized,dependencies:snapshot.dependsOn}});
    return{...result,dependencies:this.status(missionId)};
  }

  private requireMission(id:string):Mission{
    const mission=this.core.missions.get(id);
    if(!mission)throw new Error("Unknown mission: "+id);
    return mission;
  }

  private assertNoCycle(missionId:string,newDependencies:string[]){
    const visit=(id:string,path:Set<string>):void=>{
      if(id===missionId)throw new Error("Mission dependency cycle detected.");
      if(path.has(id))return;
      const next=this.dependencies.get(id)?.dependsOn??[];
      const nextPath=new Set(path);nextPath.add(id);
      for(const dependency of next)visit(dependency,nextPath);
    };
    for(const dependency of newDependencies)visit(dependency,new Set([missionId]));
  }
}
