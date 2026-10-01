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
import {MemoryEngine} from "./memory.js";
import type {RuntimePersistence} from "./runtime-persistence.js";
import {MissionHandoffManager} from "./handoff.js";
import {NextActionEngine} from "./next-action.js";
import {MissionStore} from "./mission-store.js";
import {ToolAdapterRegistry} from "../tools/adapters.js";

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

  constructor(idempotency?:IdempotencyService,persistence?:RuntimePersistence){
    this.idempotency=idempotency??new IdempotencyStore();
    this.persistence=persistence;
    this.executor=new ToolExecutor(this.tools,this.sentinel,this.idempotency);
    this.executionRuntime=new ExecutionRuntime(this);
  }

  isReady():boolean{
    return this.agents.list().length>0;
  }

  registerAgent(c:Parameters<AgentManager["register"]>[0]){this.agents.register(c);}
  discoverTools(action:string,permission:import("./types.js").PermissionLevel,agentId="core"){
    const contract=this.agents.get(agentId);
    return this.toolSelector.discover(action,contract,permission);
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
