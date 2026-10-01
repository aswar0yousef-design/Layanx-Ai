import {MissionPlanner} from "./mission.js";
import {AgentManager} from "./agent-manager.js";
import {VerificationEngine} from "./verification.js";
import {AgentLedger} from "./ledger.js";
import {RecoveryManager} from "./recovery.js";
import {PermissionEngine} from "../security/permission.js";
import {Sentinel} from "../security/sentinel.js";
import {ToolRegistry} from "../tools/registry.js";
import {ToolExecutor} from "../tools/executor.js";
import {ModelRegistry} from "../models/registry.js";
import {ModelRouter} from "./model-router.js";
import {RiskEngine} from "../security/risk.js";
import {AuditLog} from "./audit.js";
import {NoActionController} from "./no-action.js";
import {DelegationManager} from "./delegation.js";
import {AgentTeam} from "./team.js";
import {ExecutionStateStore} from "./execution-state.js";
import {MissionObservatory} from "./observatory.js";
import {LastKnownGood} from "./last-known-good.js";
import {CapabilityGate} from "../security/capability-gate.js";
import type {IdempotencyService} from "./idempotency.js";
import {IdempotencyStore} from "./idempotency.js";
import {ModelProviderRegistry,ModelExecutionRouter} from "./model-execution.js";
import {AiMissionPlanner} from "./ai-planner.js";
import {ExecutionRuntime} from "./runtime.js";
import {MissionCompiler} from "./mission-compiler.js";
import {ToolSelector} from "./tool-selection.js";
import {ToolCatalog} from "./tool-catalog.js";
import {ToolRequestBuilder} from "./tool-request-builder.js";
import {MemoryEngine} from "./memory.js";
import type {RuntimePersistence} from "./runtime-persistence.js";
import {MissionHandoffManager} from "./handoff.js";
import {NextActionEngine} from "./next-action.js";
import {MissionStore} from "./mission-store.js";
import {ToolAdapterRegistry} from "../tools/adapters.js";
import {AdaptiveDecisionEngine} from "./adaptive-decision.js";

export class LayanXCore{
  readonly planner=new MissionPlanner();
  readonly agents=new AgentManager();
  readonly verifier=new VerificationEngine();
  readonly ledger=new AgentLedger();
  readonly recovery=new RecoveryManager();
  readonly permissions=new PermissionEngine();
  readonly sentinel=new Sentinel();
  readonly tools=new ToolRegistry();
  readonly executor:ToolExecutor;
  readonly models=new ModelRegistry();
  readonly modelRouter=new ModelRouter(this.models);
  readonly providers=new ModelProviderRegistry();
  readonly modelExecution=new ModelExecutionRouter(this.models,this.providers);
  readonly aiPlanner=new AiMissionPlanner(this.modelExecution);
  readonly missionCompiler=new MissionCompiler();
  readonly toolSelector=new ToolSelector(this.tools);
  readonly toolCatalog=new ToolCatalog(this.tools);
  readonly toolRequestBuilder=new ToolRequestBuilder();
  readonly memory=new MemoryEngine();
  readonly executionRuntime:ExecutionRuntime;
  readonly persistence?:RuntimePersistence;
  readonly risk=new RiskEngine();
  readonly audit=new AuditLog();
  readonly noAction=new NoActionController();
  readonly delegation=new DelegationManager();
  readonly handoffs=new MissionHandoffManager(this.delegation);
  readonly nextAction=new NextActionEngine();
  readonly teams=new AgentTeam(this.delegation);
  readonly executionStates=new ExecutionStateStore();
  readonly observatory=new MissionObservatory();
  readonly lastKnownGood=new LastKnownGood();
  readonly capabilities=new CapabilityGate();
  readonly idempotency:IdempotencyService;
  readonly missions=new MissionStore();
  readonly toolAdapters=new ToolAdapterRegistry();
  readonly adaptiveDecision=new AdaptiveDecisionEngine();

  constructor(idempotency?:IdempotencyService,persistence?:RuntimePersistence){
    this.idempotency=idempotency??new IdempotencyStore();
    this.persistence=persistence;
    this.executor=new ToolExecutor(this.tools,this.sentinel,this.idempotency);
    this.executionRuntime=new ExecutionRuntime(this);
  }

  restoreRuntimeSnapshot(snapshot:import("./runtime-persistence.js").RuntimeSnapshot){
    this.missions.save(snapshot.mission);
    this.executionStates.restore(snapshot.executionState);
    this.ledger.restore(snapshot.ledger);
    this.audit.restore(snapshot.audit);
    this.recovery.restorePersisted(snapshot.checkpoint);
    if(snapshot.idempotency)this.idempotency.restore(snapshot.idempotency);
    if(snapshot.memory)this.memory.restore(snapshot.memory);
    if(snapshot.handoffs)this.handoffs.restore(snapshot.handoffs);
    if(snapshot.delegatedTasks)this.delegation.restore(snapshot.delegatedTasks);
    return this.missions.get(snapshot.mission.id);
  }

  isReady():boolean{
    return this.agents.list().length>0;
  }

  registerAgent(c:Parameters<AgentManager["register"]>[0]){this.agents.register(c);}
  discoverTools(action:string,permission:import("./types.js").PermissionLevel,agentId="core"){
    const contract=this.agents.get(agentId);
    return this.toolSelector.discover(action,contract,permission);
  }
  prepareMissionToolRequests(mission:import("./types.js").Mission,projectId:string,agentId="core"){
    const contract=this.agents.get(agentId);
    const catalog=this.toolCatalog.list(contract,mission.requiredPermission);
    return (mission.tools??[]).map(plan=>{
      const request=this.toolRequestBuilder.build(mission,plan,{agentId,projectId,capabilityId:"pending"},catalog);
      const token=this.capabilities.issue({missionId:mission.id,agentId,projectId,resource:plan.tool,permission:plan.permission,expiresAt:new Date(Date.now()+15*60*1000).toISOString()});
      return{request,capabilityId:token.id,expiresAt:token.expiresAt};
    });
  }
  async executeMissionTool(missionId:string,projectId:string,toolIndex=0,payload:unknown={},approvalId?:string,agentId="core",runtimeOptions:{deferVerification?:boolean}={}){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    const plans=mission.tools??[];
    const plan=plans[toolIndex];
    if(!plan)throw new Error("Mission tool plan not found.");
    const contract=this.agents.get(agentId);
    const catalog=this.toolCatalog.list(contract,mission.requiredPermission);
    const pendingRequest=this.toolRequestBuilder.build(mission,plan,{agentId,projectId,capabilityId:"pending",payload,planIndex:toolIndex},catalog);
    const token=this.capabilities.issue({missionId:mission.id,agentId,projectId,resource:plan.tool,permission:plan.permission,expiresAt:new Date(Date.now()+15*60*1000).toISOString()});
    const request={...pendingRequest,capabilityId:token.id};
    const result=await this.executionRuntime.run(mission,request,this.toolAdapters.get(plan.tool),approvalId,{projectId,capabilityId:token.id},runtimeOptions);
    this.missions.save(mission);
    return{...result,tool:plan.tool,action:plan.action,capabilityId:token.id};
  }

  private async recordAdaptiveStop(mission:import("./types.js").Mission,decision:import("./adaptive-decision.js").AdaptiveDecision,stepsExecuted:number,agentId:string){
    const metadata={missionId:mission.id,reason:decision.reason,stepsExecuted};
    this.audit.append({timestamp:new Date().toISOString(),actor:agentId,action:"mission.adaptive.stop",resource:mission.id,result:["tool_failure","planner_failure"].includes(decision.reason)?"failure":"success",metadata});
    this.memory.remember({missionId:mission.id,kind:"decision",summary:"Adaptive mission stopped: "+decision.reason,content:{reason:decision.reason,detail:decision.detail,stepsExecuted},confidence:1,tags:["mission","adaptive","stop",decision.reason]});
    await this.executionRuntime.persist(mission);
  }

  async executeMissionAdaptive(missionId:string,projectId:string,maxSteps=10,agentId="core"){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    if(["completed","cancelled"].includes(mission.status))return{missionId,results:[],completed:mission.status==="completed",reason:"Mission is already terminal."};
    const contract=this.agents.get(agentId);
    const catalog=this.toolCatalog.list(contract,mission.requiredPermission);
    if(!catalog.length)throw new Error("No tools are available for adaptive execution.");
    const completedTools:string[]=[];
    let latest:unknown={status:"not_started"};
    const results=[];
    let processed=0;

    while(processed<(mission.tools?.length??0)&&processed<maxSteps){
      const index=processed;
      const plan=mission.tools?.[index];
      if(!plan)break;
      const result=await this.executeMissionTool(missionId,projectId,index,plan.payload??{},undefined,agentId,{deferVerification:true});
      results.push(result);
      processed++;
      if(!result.ok){
        const decision=this.adaptiveDecision.decide({mission,toolResult:result.data,stepsExecuted:processed,maxSteps,nextToolAvailable:true,toolSucceeded:false});
        await this.recordAdaptiveStop(mission,decision,processed,agentId);
        return{missionId,results,completed:false,reason:result.error,recoverable:result.recoverable};
      }
      completedTools.push(plan.tool);
      latest=result.data;
    }

    const persistedDecision=this.adaptiveDecision.decide({
      mission,stepsExecuted:processed,maxSteps,nextToolAvailable:processed<(mission.tools?.length??0)
    });
    if(!persistedDecision.continue){
      await this.recordAdaptiveStop(mission,persistedDecision,processed,agentId);
      return{missionId,results,completed:false,reason:persistedDecision.detail,recoverable:true};
    }

    for(;processed<maxSteps;processed++){
      const missionMemory=this.memory.list().filter(entry=>entry.missionId===mission.id).slice(-12).map(entry=>({
        kind:entry.kind,summary:entry.summary,content:entry.content,tags:entry.tags
      }));
      let next;
      try{
        next=await this.aiPlanner.nextTool({
          goal:mission.goal,result:latest,tools:catalog,
          requiredPermission:mission.requiredPermission,completedTools,memory:missionMemory
        });
      }catch(error){
        const decision=this.adaptiveDecision.decide({
          mission,toolResult:error instanceof Error?error.message:undefined,
          stepsExecuted:processed,maxSteps,nextToolAvailable:true,plannerSucceeded:false
        });
        await this.recordAdaptiveStop(mission,decision,processed,agentId);
        return{missionId,results,completed:false,reason:decision.detail,recoverable:true};
      }
      if(!next){
        const decision=this.adaptiveDecision.decide({mission,toolResult:latest,stepsExecuted:processed,maxSteps,nextToolAvailable:false,toolSucceeded:true});
        await this.recordAdaptiveStop(mission,decision,processed,agentId);
        break;
      }
      const decision=this.adaptiveDecision.decide({
        mission,toolResult:latest,stepsExecuted:processed,maxSteps,nextToolAvailable:true,toolSucceeded:true
      });
      if(!decision.continue)break;
      mission.tools=mission.tools??[];
      mission.tools.push(next);
      this.missions.save(mission);
      const index=mission.tools.length-1;
      const result=await this.executeMissionTool(missionId,projectId,index,next.payload??{},undefined,agentId,{deferVerification:true});
      results.push(result);
      if(!result.ok){
        const decision=this.adaptiveDecision.decide({mission,toolResult:result.data,stepsExecuted:processed+1,maxSteps,nextToolAvailable:true,toolSucceeded:false});
        await this.recordAdaptiveStop(mission,decision,processed+1,agentId);
        return{missionId,results,completed:false,reason:result.error,recoverable:result.recoverable};
      }
      completedTools.push(next.tool);
      latest=result.data;
    }

    const finalDecision=this.adaptiveDecision.decide({mission,stepsExecuted:processed,maxSteps,nextToolAvailable:false,toolSucceeded:true});
    if(finalDecision.reason==="step_limit"){
      await this.recordAdaptiveStop(mission,finalDecision,processed,agentId);
      return{missionId,results,completed:false,reason:finalDecision.detail,recoverable:true};
    }
    if(!results.length){
      await this.recordAdaptiveStop(mission,finalDecision,processed,agentId);
      return{missionId,results,completed:false,reason:"Adaptive planner produced no executable tool.",recoverable:true};
    }
    const finalMission=this.missions.get(missionId);
    if(!finalMission)throw new Error("Mission not found.");
    const finalResult=await this.executionRuntime.finalize(finalMission,latest,agentId);
    this.missions.save(finalMission);
    return{missionId,results,completed:finalResult.ok,finalResult};
  }

  async executeMissionTools(missionId:string,projectId:string,payloads:unknown[]=[] ,approvalId?:string,agentId="core"){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    const plans=mission.tools??[];
    if(!plans.length)throw new Error("Mission has no executable tools.");
    const results=[];
    for(let index=0;index<plans.length;index++){
      const payload=payloads[index]??{};
      const result=await this.executeMissionTool(missionId,projectId,index,payload,approvalId,agentId);
      results.push(result);
      if(!result.ok)break;
    }
    return{missionId,results,completed:results.length===plans.length&&results.every(result=>result.ok)};
  }

  async planMission(goal:string){
    const contract=this.agents.get("core");
    const tools=this.toolCatalog.list(contract,contract.requiredPermission);
    const plan=await this.aiPlanner.plan(goal,tools);
    return this.missionCompiler.compile(plan,goal);
  }

  async planAndStartMission(goal:string){
    const m=await this.planMission(goal);
    this.executionStates.start(m.id);
    this.ledger.append({id:crypto.randomUUID(),missionId:m.id,agentId:"core",action:"mission.create",status:"started",timestamp:new Date().toISOString(),detail:goal});
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"mission.create",resource:m.id,result:"success",metadata:{goal,missionId:m.id}});
    this.missions.save(m);
    return m;
  }
  startMission(goal:string){
    const m=this.planner.create(goal);
    this.executionStates.start(m.id);
    this.ledger.append({id:crypto.randomUUID(),missionId:m.id,agentId:"core",action:"mission.create",status:"started",timestamp:new Date().toISOString(),detail:goal});
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"mission.create",resource:m.id,result:"success",metadata:{goal,missionId:m.id}});
    this.missions.save(m);
    return m;
  }
  authorize(r:import("./types.js").ToolRequest,g:import("./types.js").PermissionLevel){
    const c=this.agents.get(r.agentId);
    const p=this.permissions.authorize(r,c,g);
    if(!p.allowed){
      this.audit.append({timestamp:new Date().toISOString(),actor:r.agentId,action:r.action,resource:r.tool,result:"denied",metadata:{reason:p.reason}});
      return p;
    }
    const s=this.sentinel.inspect(r.action);
    if(!s.allowed)this.audit.append({timestamp:new Date().toISOString(),actor:r.agentId,action:r.action,resource:r.tool,result:"denied",metadata:{reason:s.reason}});
    return s;
  }
}
