import {randomUUID} from "node:crypto";
import type {LayanXCore} from "../core/orchestrator.js";
import {cloudPolicy} from "../config/providers.js";
import {pickExternalAgent} from "./external-agents.js";
import type {SupervisorDeps,ToolRun} from "./supervisor.js";
import {openInBrowser} from "../platform/open-url.js";

/**
 * Run ONE tool as its own small mission, through the full runtime (permissions, approval or
 * project trust, sentinel, audit, idempotency). Returns {ok:false, approvalId, missionId} when
 * the owner must approve; call again with resume={missionId, approvalId} after approval.
 */
export async function runSingleTool(core:LayanXCore,projectId:string,tool:string,payload:Record<string,unknown>,resume?:{missionId:string;approvalId:string}):Promise<ToolRun&Record<string,unknown>>{
  const def=core.tools.get(tool);
  const action=(def.actions??[])[0];
  if(!action)throw new Error(`Tool ${tool} has no action.`);
  let mission=resume?core.missions.get(resume.missionId):undefined;
  if(!mission){
    mission=core.startMission(`${action} ${JSON.stringify(payload).slice(0,160)}`.trim(),projectId);
    mission.requiredPermission=def.permission;
    mission.tools=[{tool,action,permission:def.permission,reason:"owner quick action",payload}];
    mission.steps=[{id:randomUUID(),description:"Execute "+action,status:"pending"}];
    mission.successCriteria=["done"];
    core.missions.save(mission);
  }
  const plan=mission.tools?.[0];
  const result=await core.executeMissionTool(mission.id,projectId,0,plan?.payload??payload,resume?.approvalId,"core") as Record<string,unknown>;
  return{...result,missionId:mission.id} as ToolRun&Record<string,unknown>;
}

export function coreSupervisorDeps(core:LayanXCore):SupervisorDeps{
  const cloudReady=()=>cloudPolicy()!=="off"&&core.models.list().some(m=>!m.local&&m.enabled);
  return{
    async think(prompt,opts={}){
      const images=opts.images??[];
      const r=await core.modelExecution.execute({
        capability:images.length?"vision":"reasoning",
        input:images.length?[{type:"text",text:prompt},...images.map(image=>({type:"image" as const,image}))]:prompt,
        maxOutputTokens:1500,
        routing:opts.cloud?{preferLocal:false}:{preferLocal:true}
      });
      return r.output;
    },
    runAgent:(goal,projectId,agentId,routing)=>core.runAgentGateway(goal,projectId,15,{},agentId,routing) as never,
    resumeAgent:(missionId,projectId,agentId,approvals,routing)=>core.executeAgentLoop(missionId,projectId,15,approvals,agentId,routing) as never,
    runTool:(projectId,tool,payload,resume)=>runSingleTool(core,projectId,tool,payload,resume).catch(error=>({ok:false,error:(error as Error).message})),
    isApproved:id=>core.executionRuntime.approvals.isApproved(id),
    cloudAvailable:cloudReady,
    externalAgent:()=>{const a=pickExternalAgent("auto");return a&&(a.kind==="local"||cloudReady())?{name:a.name,kind:a.kind}:null;},
    openUrl:url=>{if(process.env.LAYANX_OPEN_BROWSER!=="off")openInBrowser(url);}
  };
}
