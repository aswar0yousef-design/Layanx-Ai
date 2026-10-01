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
import type {PermissionLevel,ToolRequest} from "./types.js";
import type {AgentContract} from "./contracts.js";

export class LayanXCore{
 readonly planner=new MissionPlanner();
 readonly agents=new AgentManager();
 readonly verifier=new VerificationEngine();
 readonly ledger=new AgentLedger();
 readonly recovery=new RecoveryManager();
 readonly permissions=new PermissionEngine();
 readonly sentinel=new Sentinel();
 readonly tools=new ToolRegistry();
 readonly executor=new ToolExecutor(this.tools,this.sentinel);
 readonly models=new ModelRegistry();
 readonly modelRouter=new ModelRouter(this.models);

 registerAgent(c:AgentContract){this.agents.register(c);}
 startMission(goal:string){const m=this.planner.create(goal);this.ledger.append({id:crypto.randomUUID(),missionId:m.id,agentId:"core",action:"mission.create",status:"started",timestamp:new Date().toISOString(),detail:goal});return m;}
 authorize(r:ToolRequest,g:PermissionLevel){const c=this.agents.get(r.agentId);const p=this.permissions.authorize(r,c,g);if(!p.allowed)return p;return this.sentinel.inspect(r.action);}
}