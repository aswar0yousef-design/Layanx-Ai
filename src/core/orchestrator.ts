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
  readonly risk=new RiskEngine();
  readonly audit=new AuditLog();
  readonly noAction=new NoActionController();
  readonly delegation=new DelegationManager();
  readonly teams=new AgentTeam(this.delegation);
  readonly executionStates=new ExecutionStateStore();
  readonly observatory=new MissionObservatory();
  readonly lastKnownGood=new LastKnownGood();
  readonly capabilities=new CapabilityGate();
  readonly idempotency:IdempotencyService;

  constructor(idempotency?:IdempotencyService){
    this.idempotency=idempotency??new IdempotencyStore();
    this.executor=new ToolExecutor(this.tools,this.sentinel,this.idempotency);
  }

  registerAgent(c:Parameters<AgentManager["register"]>[0]){this.agents.register(c);}
  startMission(goal:string){
    const m=this.planner.create(goal);
    this.executionStates.start(m.id);
    this.ledger.append({id:crypto.randomUUID(),missionId:m.id,agentId:"core",action:"mission.create",status:"started",timestamp:new Date().toISOString(),detail:goal});
    this.audit.append({timestamp:new Date().toISOString(),actor:"core",action:"mission.create",resource:m.id,result:"success",metadata:{goal,missionId:m.id}});
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
