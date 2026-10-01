import {MissionPlanner} from "./mission.js";
import {AgentManager} from "./agent-manager.js";
import {VerificationEngine} from "./verification.js";
import {AgentLedger} from "./ledger.js";
import {PermissionEngine} from "../security/permission.js";
import {Sentinel} from "../security/sentinel.js";
import type {PermissionLevel,ToolRequest} from "./types.js";
import type {AgentContract} from "./contracts.js";

export class LayanXCore{
 readonly planner=new MissionPlanner();readonly agents=new AgentManager();readonly verifier=new VerificationEngine();readonly ledger=new AgentLedger();readonly permissions=new PermissionEngine();readonly sentinel=new Sentinel();
 registerAgent(c:AgentContract){this.agents.register(c);}
 startMission(goal:string){const m=this.planner.create(goal);this.ledger.append({id:crypto.randomUUID(),missionId:m.id,agentId:"core",action:"mission.create",status:"started",timestamp:new Date().toISOString(),detail:goal});return m;}
 authorize(r:ToolRequest,g:PermissionLevel){const c=this.agents.get(r.agentId);const p=this.permissions.authorize(r,c,g);if(!p.allowed)return p;return this.sentinel.inspect(r.action);}
}