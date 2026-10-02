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
import {ProjectIsolation} from "../security/project-isolation.js";
import {ContextFabric} from "./context-fabric.js";
import {SkillRegistry} from "../skills/registry.js";
import {SkillRuntime} from "../skills/runtime.js";
import {AgentTeamRuntime} from "./team-runtime.js";
import {ProjectIntelligence} from "./project-intelligence.js";
import {ProjectGraph} from "./project-graph.js";
import {ChangeImpactAnalyzer} from "./impact-analysis.js";
import {AutomaticTestSelector} from "./test-selection.js";
import {AutonomousRepairLoop} from "./autonomous-repair.js";
import {createHash} from "node:crypto";
import {MissionEventStream} from "./event-stream.js";
import {AutomaticTestRunner, type TestRunResult} from "./test-runner.js";
import {TaskDecomposer} from "./task-decomposition.js";
import {TaskRouter} from "./task-router.js";
import {TaskRuntime} from "./task-runtime.js";
import type {ModelRoutingOptions} from "../models/inference.js";

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
  readonly contextFabric=new ContextFabric(this.memory);
  readonly executionRuntime:ExecutionRuntime;
  readonly persistence?:RuntimePersistence;
  readonly risk=new RiskEngine();
  readonly audit=new AuditLog();
  readonly noAction=new NoActionController();
  readonly delegation=new DelegationManager();
  readonly handoffs=new MissionHandoffManager(this.delegation);
  readonly nextAction=new NextActionEngine();
  readonly teams=new AgentTeam(this.delegation);
  readonly teamRuntime:AgentTeamRuntime;
  readonly executionStates=new ExecutionStateStore();
  readonly observatory=new MissionObservatory();
  readonly lastKnownGood=new LastKnownGood();
  readonly capabilities=new CapabilityGate();
  readonly idempotency:IdempotencyService;
  readonly missions=new MissionStore();
  readonly toolAdapters=new ToolAdapterRegistry();
  readonly adaptiveDecision=new AdaptiveDecisionEngine();
  readonly projectIsolation=new ProjectIsolation();
  readonly projectIntelligence=new ProjectIntelligence({root:process.env.LAYANX_WORKSPACE_ROOT??process.cwd()});
  readonly projectGraph=new ProjectGraph({root:process.env.LAYANX_WORKSPACE_ROOT??process.cwd()});
  readonly impactAnalyzer=new ChangeImpactAnalyzer();
  readonly testSelector=new AutomaticTestSelector();
  readonly autonomousRepair=new AutonomousRepairLoop();
  readonly eventStream=new MissionEventStream();
  readonly testRunner=new AutomaticTestRunner({root:process.env.LAYANX_WORKSPACE_ROOT??process.cwd()});
  readonly taskDecomposer=new TaskDecomposer(this.modelExecution);
  readonly taskRouter=new TaskRouter(this.agents,this.modelRouter);
  readonly taskRuntime:TaskRuntime;
  readonly skills=new SkillRegistry();
  readonly skillRuntime:SkillRuntime;

  constructor(idempotency?:IdempotencyService,persistence?:RuntimePersistence){
    this.idempotency=idempotency??new IdempotencyStore();
    this.persistence=persistence;
    this.executor=new ToolExecutor(this.tools,this.sentinel,this.idempotency);
    this.executionRuntime=new ExecutionRuntime(this);
    this.skillRuntime=new SkillRuntime(this.skills,async(missionId,projectId,toolIndex,payload)=>this.executeMissionTool(missionId,projectId,toolIndex,payload));
    this.teamRuntime=new AgentTeamRuntime(this.delegation,this.agents,this.projectIsolation);
    this.taskRuntime=new TaskRuntime(this);
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
  prepareMissionToolRequests(mission:import("./types.js").Mission,projectId:string,agentId="core" ){
    this.projectIsolation.assertMissionProject(projectId,mission.projectId);
    const contract=this.agents.get(agentId);
    const catalog=this.toolCatalog.list(contract,mission.requiredPermission);
    return (mission.tools??[]).map(plan=>{
      const request=this.toolRequestBuilder.build(mission,plan,{agentId,projectId,capabilityId:"pending"},catalog);
      const token=this.capabilities.issue({missionId:mission.id,agentId,projectId,resource:plan.tool,permission:plan.permission,expiresAt:new Date(Date.now()+15*60*1000).toISOString()});
      return{request,capabilityId:token.id,expiresAt:token.expiresAt};
    });
  }
  async prepareTaskDecomposition(goal:string,projectId="default",projectContext?:unknown){
    const decomposition=await this.taskDecomposer.decompose(goal,projectContext);
    const assignments=this.taskRouter.assign(decomposition);
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"mission.task.decompose",resource:goal.slice(0,120),result:"success",metadata:{projectId,tasks:decomposition.tasks.length,taskIds:decomposition.tasks.map(task=>task.id)}});
    this.memory.remember({missionId:"decomposition:"+crypto.randomUUID(),projectId,kind:"decision",summary:"Mission tasks decomposed and routed",content:{decomposition,assignments},confidence:1,tags:["mission","decomposition","routing"]});
    return{...decomposition,assignments};
  }
  async executeTaskDecomposition(goal:string,projectId="default",maxConcurrency=3,projectContext?:unknown){
    const prepared=await this.prepareTaskDecomposition(goal,projectId,projectContext);
    const result=await this.taskRuntime.run(prepared,prepared.assignments,projectId,maxConcurrency);
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"mission.task.execute",resource:goal.slice(0,120),result:result.completed?"success":"failure",metadata:{projectId,tasks:prepared.tasks.length,maxConcurrency}});
    return{...prepared,result};
  }

  async prepareChangeImpact(mission:import("./types.js").Mission,projectId:string,request?:{tool?:string;action?:string}){
    this.projectIsolation.assertMissionProject(projectId,mission.projectId);
    const graph=await this.projectGraph.scan(projectId);
    const query=[mission.goal,request?.action,request?.tool].filter(Boolean).join(" ");
    const impact=this.impactAnalyzer.analyze(graph,query);
    const selection=this.testSelector.select(graph,impact);
    mission.impactAnalysis=impact;
    mission.selectedTests=selection.tests;
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"mission.impact.analyze",resource:mission.id,result:"success",metadata:{missionId:mission.id,projectId,risk:impact.risk,score:impact.score,affectedFiles:impact.affectedFiles.length,affectedTests:selection.tests.length}});
    this.memory.remember({missionId:mission.id,projectId,kind:"decision",summary:"Change impact analyzed before modification",content:{impact,selectedTests:selection.tests},confidence:1,tags:["impact","preflight","tests"]});
    return{impact,selectedTests:selection.tests};
  }

  async executeMissionTool(missionId:string,projectId:string,toolIndex=0,payload:unknown={},approvalId?:string,agentId="core",runtimeOptions:{deferVerification?:boolean}={}){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    this.projectIsolation.assertMissionProject(projectId,mission.projectId);
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

  async executeAgentTeam(parentMissionId:string,projectId:string,tasks:import("./delegation.js").DelegatedTask[],executor:import("./team-runtime.js").TeamTaskExecutor,maxRepairs=1){
    const mission=this.missions.get(parentMissionId);
    if(!mission)throw new Error("Mission not found.");
    return this.teamRuntime.run(parentMissionId,projectId,mission.projectId,tasks,executor,maxRepairs);
  }

  async executeSkill(skillId:string,missionId:string,projectId:string,payloads:unknown[]=[]){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    return this.skillRuntime.run(skillId,mission,projectId,payloads);
  }

  async runSelectedTests(mission:import("./types.js").Mission,projectId:string,tests=mission.selectedTests??[]):Promise<TestRunResult>{
    this.projectIsolation.assertMissionProject(projectId,mission.projectId);
    const result=await this.testRunner.run(tests);
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"tests.run",resource:mission.id,result:result.ok?"success":"failure",metadata:{missionId:mission.id,projectId,tests:result.tests,passed:result.passed,failed:result.failed,timedOut:result.timedOut,durationMs:result.durationMs}});
    this.memory.remember({missionId:mission.id,projectId,kind:result.ok?"experience":"failure",summary:result.ok?"Selected tests passed":"Selected tests failed",content:{tests:result.tests,passed:result.passed,failed:result.failed,exitCode:result.exitCode,signal:result.signal,timedOut:result.timedOut,stdout:result.stdout,stderr:result.stderr,error:result.error},confidence:1,tags:["tests","verification",result.ok?"success":"failure"]});
    return result;
  }

  private async recordAdaptiveStop(mission:import("./types.js").Mission,decision:import("./adaptive-decision.js").AdaptiveDecision,stepsExecuted:number,agentId:string){
    const metadata={missionId:mission.id,reason:decision.reason,stepsExecuted};
    this.audit.append({timestamp:new Date().toISOString(),actor:agentId,action:"mission.adaptive.stop",resource:mission.id,result:["tool_failure","planner_failure"].includes(decision.reason)?"failure":"success",metadata});
    this.memory.remember({missionId:mission.id,projectId:mission.projectId,kind:"decision",summary:"Adaptive mission stopped: "+decision.reason,content:{reason:decision.reason,detail:decision.detail,stepsExecuted},confidence:1,tags:["mission","adaptive","stop",decision.reason]});
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
      mission,stepsExecuted:processed,maxSteps,nextToolAvailable:processed<maxSteps
    });
    if(!persistedDecision.continue){
      await this.recordAdaptiveStop(mission,persistedDecision,processed,agentId);
      return{missionId,results,completed:false,reason:persistedDecision.detail,recoverable:true};
    }

    for(;processed<maxSteps;processed++){
      const missionContext=this.contextFabric.build({projectId,mission,query:mission.goal,limit:12,maxChars:8000});
      const missionMemory=missionContext.memories.filter(entry=>entry.missionId===mission.id).map(entry=>({
        kind:entry.kind,summary:entry.summary,content:entry.content,tags:entry.tags
      }));
      let next;
      try{
        next=await this.aiPlanner.nextTool({
          goal:mission.goal,result:latest,tools:catalog,
          requiredPermission:mission.requiredPermission,completedTools,memory:missionMemory,
          projectContext:await this.projectIntelligence.scan(projectId).then(intelligence=>({summary:intelligence.summary,markers:intelligence.markers,package:intelligence.package,files:intelligence.files.slice(0,80).map(file=>file.path)})).catch(error=>({unavailable:true,reason:error instanceof Error?error.message:"project intelligence unavailable"}))
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
      if(!decision.continue){
        await this.recordAdaptiveStop(mission,decision,processed,agentId);
        break;
      }
      mission.tools=mission.tools??[];
      mission.tools.push(next);
      this.missions.save(mission);
      const index=mission.tools.length-1;
      const result=await this.executeMissionTool(missionId,projectId,index,next.payload??{},undefined,agentId,{deferVerification:true});
      results.push(result);
      if(!result.ok){
        const repair=this.autonomousRepair.run(mission,result,{
          planner:this.aiPlanner,
          tools:catalog,
          memory:missionMemory,
          projectContext:await this.projectIntelligence.scan(projectId).then(i=>({summary:i.summary,markers:i.markers,package:i.package,files:i.files.slice(0,80).map(f=>f.path)})).catch(()=>undefined),
          execute:async(repairPlan)=>{
            mission.tools=mission.tools??[];
            mission.tools.push(repairPlan);
            const repairIndex=mission.tools.length-1;
            return this.executeMissionTool(missionId,projectId,repairIndex,repairPlan.payload??{},undefined,agentId,{deferVerification:true});
          }
        },3);
        if(repair.completed)return{missionId,results:[...results,...repair.results],completed:true,repaired:true,repairAttempts:repair.attempts};
        const decision=this.adaptiveDecision.decide({mission,toolResult:result.data,stepsExecuted:processed+1,maxSteps,nextToolAvailable:true,toolSucceeded:false});
        await this.recordAdaptiveStop(mission,decision,processed+1,agentId);
        return{missionId,results:[...results,...repair.results],completed:false,reason:repair.reason??result.error,recoverable:result.repaired||result.recoverable};
      }
      completedTools.push(next.tool);
      latest=result.data;

      const permissionRank:Record<import("./types.js").PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
      if(result.ok&&permissionRank[next.permission]>=3&&mission.selectedTests?.length){
        const tests=await this.runSelectedTests(mission,projectId,mission.selectedTests);
        if(!tests.ok){
          const testFailure:import("./runtime.js").RuntimeResult={
            ok:false,missionId:mission.id,verified:false,recoverable:true,
            error:[tests.error??"Selected tests failed.",tests.stderr,tests.stdout].filter(Boolean).join("\n"),
            data:{tests:tests.tests,failed:tests.failed,exitCode:tests.exitCode,timedOut:tests.timedOut}
          };
          const repair=this.autonomousRepair.run(mission,testFailure,{
            planner:this.aiPlanner,
            tools:catalog,
            memory:missionMemory,
            projectContext:await this.projectIntelligence.scan(projectId).then(i=>({summary:i.summary,markers:i.markers,package:i.package,files:i.files.slice(0,80).map(f=>f.path)})).catch(()=>undefined),
            execute:async(repairPlan)=>{
              mission.tools=mission.tools??[];
              mission.tools.push(repairPlan);
              const repairIndex=mission.tools.length-1;
              const repairResult=await this.executeMissionTool(missionId,projectId,repairIndex,repairPlan.payload??{},undefined,agentId,{deferVerification:true});
              if(!repairResult.ok)return repairResult;
              const retest=await this.runSelectedTests(mission,projectId,mission.selectedTests??[]);
              return {...repairResult,verified:retest.ok,error:retest.ok?undefined:[retest.error??"Retest failed.",retest.stderr,retest.stdout].filter(Boolean).join("\n"),data:{repair:repairResult.data,retest}};
            }
          },3);
          if(repair.completed)return{missionId,results:[...results,...repair.results],completed:true,repaired:true,repairAttempts:repair.attempts};
          await this.recordAdaptiveStop(mission,{continue:false,reason:"tool_failure",detail:repair.reason??"Selected tests failed after repair attempts."},processed+1,agentId);
          return{missionId,results:[...results,...repair.results],completed:false,reason:repair.reason??testFailure.error,recoverable:true};
        }
      }
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

  async executeMissionRepair(missionId:string,projectId:string,maxRepairAttempts=3,agentId="core"){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    this.projectIsolation.assertMissionProject(projectId,mission.projectId);
    if(["completed","cancelled"].includes(mission.status))return{missionId,completed:mission.status==="completed",attempts:0,repaired:false,exhausted:false,blocked:false,results:[],reason:"Mission is already terminal."};
    const limit=this.autonomousRepair.normalizeAttempts(maxRepairAttempts);
    const results:import("./autonomous-repair.js").RepairAttempt[]=[];
    let latest:unknown={status:"not_started"};
    let repaired=false;

    for(let index=0;index<(mission.tools?.length??0);index++){
      const plan=mission.tools?.[index];
      if(!plan)break;
      const result=await this.executeMissionTool(missionId,projectId,index,plan.payload??{},undefined,agentId,{deferVerification:true});
      results.push({attempt:0,tool:plan.tool,action:plan.action,ok:result.ok,error:result.error,data:result.data});
      latest=result.data??result.error;
      if(!result.ok)break;
    }

    let failure=results.find(item=>!item.ok);
    if(!failure){
      const finalMission=this.missions.get(missionId);
      if(!finalMission)throw new Error("Mission not found.");
      const finalResult=await this.executionRuntime.finalize(finalMission,latest,agentId);
      this.missions.save(finalMission);
      return{missionId,completed:finalResult.ok,attempts:0,repaired:false,exhausted:false,blocked:false,results,reason:finalResult.error};
    }

    for(let attempt=1;attempt<=limit;attempt++){
      const current=this.missions.get(missionId);
      if(!current)throw new Error("Mission not found.");
      const activeFailure=failure??{attempt:attempt-1,ok:false,error:"Previous repair attempt failed."};
      if(current.status==="blocked")return{missionId,completed:false,attempts:attempt-1,repaired,exhausted:false,blocked:true,results,reason:activeFailure.error};
      current.status="running";
      this.executionStates.update(missionId,{status:"running",recoverable:true});
      this.missions.save(current);

      const context=await this.projectIntelligence.scan(projectId).then(intelligence=>({
        summary:intelligence.summary,markers:intelligence.markers,package:intelligence.package,
        files:intelligence.files.slice(0,80).map(file=>file.path)
      })).catch(error=>({unavailable:true,reason:error instanceof Error?error.message:"project intelligence unavailable"}));
      const catalog=this.toolCatalog.list(this.agents.get(agentId),current.requiredPermission);
      let next;
      try{
        next=await this.aiPlanner.nextTool({
          goal:current.goal,
          result:{failure:activeFailure.error,previousResult:latest,attempt},
          tools:catalog,
          requiredPermission:current.requiredPermission,
          completedTools:results.filter(item=>item.ok&&item.tool).map(item=>item.tool as string),
          memory:this.contextFabric.build({projectId,mission:current,query:current.goal,limit:12,maxChars:8000}).memories.map(entry=>({kind:entry.kind,summary:entry.summary,content:entry.content,tags:entry.tags})),
          projectContext:context
        });
      }catch(error){
        failure={attempt,ok:false,error:error instanceof Error?error.message:"repair planner failed"};
        results.push(failure);
        break;
      }
      if(!next){
        if(repaired){
          const finalMission=this.missions.get(missionId);
          if(!finalMission)throw new Error("Mission not found.");
          const finalResult=await this.executionRuntime.finalize(finalMission,latest,agentId);
          this.missions.save(finalMission);
          if(finalResult.ok)return{missionId,completed:true,attempts:attempt,repaired,exhausted:false,blocked:false,results};
          failure={attempt,ok:false,error:finalResult.error??"Verification failed after repair."};
          results.push(failure);
          continue;
        }
        failure={attempt,ok:false,error:"Repair planner produced no corrective action."};
        results.push(failure);
        break;
      }
      if(!this.autonomousRepair.isSafeRepairPermission(next.permission)){
        failure={attempt,tool:next.tool,action:next.action,ok:false,error:"Repair action exceeds the autonomous repair permission boundary."};
        results.push(failure);
        break;
      }
      current.tools=current.tools??[];
      current.tools.push(next);
      this.missions.save(current);
      const toolIndex=current.tools.length-1;
      const result=await this.executeMissionTool(missionId,projectId,toolIndex,next.payload??{},undefined,agentId,{deferVerification:true});
      results.push({attempt,tool:next.tool,action:next.action,ok:result.ok,error:result.error,data:result.data});
      latest=result.data??result.error;
      if(result.ok){
        repaired=true;
        failure=undefined;
      }else{
        failure=results[results.length-1];
        if(this.missions.get(missionId)?.status==="blocked")return{missionId,completed:false,attempts:attempt,repaired,exhausted:false,blocked:true,results,reason:result.error};
      }
    }
    return{missionId,completed:false,attempts:limit,repaired,exhausted:true,blocked:false,results,reason:failure?.error??"Repair attempts exhausted."};
  }

  async runAgentGateway(goal:string,projectId="default",maxSteps=10,approvalIds:Record<number,string>={},agentId="core",routing?:ModelRoutingOptions){
    const mission=await this.planAndStartMission(goal,projectId,routing);
    const result=await this.executeAgentLoop(mission.id,projectId,maxSteps,approvalIds,agentId,routing);
    return{goal:mission.goal,projectId,agentId,...result,missionId:mission.id};
  }

  async executeAgentLoop(missionId:string,projectId:string,maxSteps=10,approvalIds:Record<number,string>={},agentId="core",routing?:ModelRoutingOptions){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    this.projectIsolation.assertMissionProject(projectId,mission.projectId);
    const limit=Math.min(Math.max(Math.floor(maxSteps),1),25);
    const results:unknown[]=[];
    let latest:unknown={status:"not_started"};
    let steps=0;
    while(steps<limit){
      const current=this.missions.get(missionId);
      if(!current)throw new Error("Mission not found.");
      if(["completed","cancelled"].includes(current.status))return{missionId,completed:current.status==="completed",status:current.status,steps,results};
      const plans=current.tools??[];
      const index=steps<plans.length?steps:-1;
      let plan=index>=0?plans[index]:undefined;
      if(!plan){
        const catalog=this.toolCatalog.list(this.agents.get(agentId),current.requiredPermission);
        const context=await this.projectIntelligence.scan(projectId).then(i=>({summary:i.summary,markers:i.markers,package:i.package,files:i.files.slice(0,80).map(f=>f.path)})).catch(error=>({unavailable:true,reason:error instanceof Error?error.message:"project intelligence unavailable"}));
        plan=await this.aiPlanner.nextTool({
          goal:current.goal,result:latest,tools:catalog,requiredPermission:current.requiredPermission,
          routing,
          completedTools:plans.slice(0,index<0?plans.length:index).map(item=>item.tool),
          memory:this.contextFabric.build({projectId,mission:current,query:current.goal,limit:8,maxChars:6000}).memories.map(e=>({kind:e.kind,summary:e.summary,content:e.content,tags:e.tags})),
          projectContext:context
        })??undefined;
        if(!plan)break;
        current.tools=current.tools??[];
        current.tools.push(plan);
        this.missions.save(current);
        plan=current.tools[current.tools.length-1]!;
      }
      const toolIndex=(this.missions.get(missionId)?.tools??[]).findIndex(item=>item===plan);
      const actualIndex=toolIndex>=0?toolIndex:(this.missions.get(missionId)?.tools?.length??1)-1;
      const result=await this.executeMissionTool(missionId,projectId,actualIndex,plan.payload??{},approvalIds[actualIndex],agentId,{deferVerification:true});
      results.push(result);
      steps++;
      latest=result.ok?result.data:result.error;
      if(!result.ok){
        if(result.error==="Explicit approval is required for this risk level."||result.error==="Approval missing, revoked, or expired."||result.error==="Approval scope mismatch.")
          return{missionId,completed:false,status:"awaiting_approval",paused:true,steps,nextToolIndex:actualIndex,results};
        const repair=this.aiPlanner.nextTool({
          goal:current.goal,result:{failure:result.error,latest},tools:this.toolCatalog.list(this.agents.get(agentId),current.requiredPermission),
          requiredPermission:current.requiredPermission,routing,completedTools:results.map(item=>(item as {tool?:string}).tool??""),
          projectContext:{repairAfterFailure:true}
        });
        const recoveryPlan=await repair;
        if(!recoveryPlan)return{missionId,completed:false,status:"failed",steps,results,reason:result.error};
        current.tools=current.tools??[];
        current.tools.push(recoveryPlan);
        this.missions.save(current);
      }
    }
    const finalMission=this.missions.get(missionId);
    if(!finalMission)throw new Error("Mission not found.");
    if(!results.length)return{missionId,completed:false,status:finalMission.status,steps,results,reason:"Agent loop produced no executable result."};
    const final=await this.executionRuntime.finalize(finalMission,latest,agentId);
    this.missions.save(finalMission);
    return{missionId,completed:final.ok,status:finalMission.status,steps,results,final};
  }

  async getDevelopmentSessionState(missionId:string,projectId:string,agentId="core"){
    const mission=this.missions.get(missionId);
    if(mission)this.projectIsolation.assertMissionProject(projectId,mission.projectId);
    const snapshot=await this.persistence?.get(missionId);
    if(!snapshot)return{missionId,exists:false,resumable:false};
    if(snapshot.mission.projectId!==projectId)throw new Error("Project isolation violation.");
    const pending=Math.min(snapshot.executionState.toolCalls,snapshot.mission.tools?.length??0);
    return{
      missionId,exists:true,resumable:(await this.persistence?.resumable()??[]).some(item=>item.mission.id===missionId),
      missionStatus:snapshot.mission.status,executionStatus:snapshot.executionState.status,
      recoverable:snapshot.executionState.recoverable,pendingToolIndex:pending>=0?pending:null,
      toolCalls:snapshot.executionState.toolCalls,runtimeMs:snapshot.executionState.runtimeMs,
      nextAction:snapshot.nextAction,checkpoint:snapshot.checkpoint,
      savedAt:snapshot.savedAt,agentId
    };
  }

  async resumeDevelopmentSession(missionId:string,projectId:string,approvalIds:Record<number,string>={},agentId="core"){
    const state=await this.getDevelopmentSessionState(missionId,projectId,agentId);
    if(!state.exists)throw new Error("No persisted development session found.");
    if(!state.resumable)throw new Error("Development session is not resumable.");
    return this.executeDevelopmentSession(missionId,projectId,approvalIds,agentId);
  }

  async executeDevelopmentSession(missionId:string,projectId:string,approvalIds:Record<number,string>={},agentId="core"){
    const mission=this.missions.get(missionId);
    if(!mission)throw new Error("Mission not found.");
    this.projectIsolation.assertMissionProject(projectId,mission.projectId);
    if(["completed","cancelled"].includes(mission.status))return{missionId,status:mission.status,completed:mission.status==="completed",blocked:false,paused:false,nextToolIndex:null,results:[]};
    const plans=mission.tools??[];
    const missing:number[]=[];
    for(let index=0;index<plans.length;index++){
      const plan=plans[index]!;
      const request={missionId,agentId,tool:plan.tool,action:plan.action,permission:plan.permission,idempotencyKey:"session-preflight-"+missionId+"-"+index,payload:plan.payload??{},planIndex:index};
      const tool=this.tools.get(plan.tool);
      const risk=this.risk.assess(request);
      if(risk.requiresApproval||tool.dangerous){
        const approvalId=approvalIds[index];
        if(!approvalId){
          missing.push(index);
          continue;
        }
        const check=this.executionRuntime.approvals.validate(approvalId,{
          missionId,agentId,tool:plan.tool,action:plan.action,permission:plan.permission,
          payloadHash:createHash("sha256").update(JSON.stringify(request.payload??null)).digest("hex")
        });
        if(!check.allowed)missing.push(index);
      }
    }
    if(missing.length){
      return{missionId,status:"awaiting_approval",completed:false,blocked:false,paused:true,nextToolIndex:missing[0],missingApprovals:missing,results:[]};
    }
    const results:unknown[]=[];
    for(let index=0;index<plans.length;index++){
      const plan=plans[index]!;
      const result=await this.executeMissionTool(missionId,projectId,index,plan.payload??{},approvalIds[index],agentId,{deferVerification:true});
      results.push(result);
      if(!result.ok)return{missionId,status:this.missions.get(missionId)?.status??"failed",completed:false,blocked:result.error==="Explicit approval is required for this risk level.",paused:false,nextToolIndex:index,results};
    }
    const finalMission=this.missions.get(missionId);
    if(!finalMission)throw new Error("Mission not found.");
    const final=await this.executionRuntime.finalize(finalMission,results[results.length-1]!,agentId);
    this.missions.save(finalMission);
    return{missionId,status:final.ok?"completed":finalMission.status,completed:final.ok,blocked:false,paused:false,nextToolIndex:null,results,final};
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

  async planMission(goal:string,projectId="default",routing?:ModelRoutingOptions){
    const contract=this.agents.get("core");
    const tools=this.toolCatalog.list(contract,contract.requiredPermission);
    let projectContext:unknown=null;
    try{
      const intelligence=await this.projectIntelligence.scan(this.projectIsolation.normalize(projectId));
      projectContext={summary:intelligence.summary,markers:intelligence.markers,package:intelligence.package,files:intelligence.files.slice(0,80).map(file=>file.path)};
    }catch(error){
      projectContext={unavailable:true,reason:error instanceof Error?error.message:"project intelligence unavailable"};
    }
    const plan=await this.aiPlanner.plan(goal,tools,projectContext,routing);
    return this.missionCompiler.compile(plan,goal);
  }

  async planAndStartMission(goal:string,projectId="default",routing?:ModelRoutingOptions){
    const normalizedProjectId=this.projectIsolation.normalize(projectId);
    const m=await this.planMission(goal,normalizedProjectId,routing);
    m.projectId=normalizedProjectId;
    this.executionStates.start(m.id);
    this.ledger.append({id:crypto.randomUUID(),missionId:m.id,agentId:"core",action:"mission.create",status:"started",timestamp:new Date().toISOString(),detail:goal});
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"mission.create",resource:m.id,result:"success",metadata:{goal,missionId:m.id}});
    this.missions.save(m);
    return m;
  }
  startMission(goal:string,projectId="default"){
    const m=this.planner.create(goal);
    m.projectId=this.projectIsolation.normalize(projectId);
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
