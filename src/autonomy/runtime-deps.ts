import {randomUUID} from "node:crypto";
import type {LayanXCore} from "../core/orchestrator.js";
import {cloudPolicy} from "../config/providers.js";
import {pickExternalAgent} from "./external-agents.js";
import type {SupervisorDeps,ToolRun} from "./supervisor.js";
import {openInBrowser} from "../platform/open-url.js";
import {composeTaskTestSource,TASK_SERVER_SKELETON,TASK_TEST_HARNESS,taskTestContractViolations} from "./task-app-verifier.js";

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
  const generateSource=async(input:string,routing?:{preferLocal:boolean})=>{
    const response=await core.modelExecution.execute({
      capability:"coding",routing:routing??{preferLocal:true},maxOutputTokens:3000,
      responseSchema:{type:"object",properties:{content:{type:"string"}},required:["content"],additionalProperties:false},
      input
    });
    const output=JSON.parse(response.output) as {content?:unknown}|null;
    if(typeof output?.content!=="string"||!output.content.trim())throw new Error("Coding model returned no source.");
    return {content:output.content,modelId:response.modelId};
  };
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
    async generateTaskServer(goal,previous,routing){
      return generateSource([
          "Return a JSON object with one content string containing the complete runnable JavaScript file. No markdown, tool calls, stubs or TODOs.",
          goal,
          "Only src/server.mjs is written. Copy this structure exactly, keep every helper unchanged, and fill in only the two commented places. loadTasks returns a plain array and saveTasks takes that plain array; never wrap it in {tasks} yourself:\n"+TASK_SERVER_SKELETON,
          "Routes to add, each one if statement ending in return: GET / sends page with Content-Type text/html; charset=utf-8. GET /tasks returns json(res,200,{tasks:loadTasks()}). POST /tasks parses await readBody(req), pushes {id:String(Date.now()),title} and saves, then returns the task with status 201. DELETE when route starts with /tasks/: id is decodeURIComponent(route.slice(7)), keep tasks whose String(task.id) differs, save, return json(res,200,{deleted:true}).",
          "Browser code goes between the script tags as normal multi-line JavaScript. The whole file must never contain a double-quote character: use single quotes everywhere and leave HTML attributes unquoted. Never write a backtick or a dollar-brace in browser code. Build URLs with +, for example fetch('/tasks/'+task.id,{method:'DELETE'}). Load rows from GET /tasks, set titles with textContent, give each row a button labelled Delete / حذف, and make the Add / إضافة button POST the title. document, window and location exist only in that browser code, never in Node code.",
          previous?"Existing source to repair (replace it with the complete corrected file):\n"+previous:""
      ].filter(Boolean).join("\n\n"),routing);
    },
    async generateTaskTests(goal,server,routing){
      const candidate=await generateSource([
        "Return only JSON with a content string holding ONLY the JavaScript statements that go inside the harness below. No imports, no test() call, no require, no tool calls and no server code. Use single quotes only; never write a double-quote character.",
        goal,
        "The harness is added for you and already defines assert, url, open and close. A restart changes the port, so write: await close(); url=await open();\n"+TASK_TEST_HARNESS,
        "In order, assert: GET /health is {ok:true}; GET /tasks starts empty; a fetch with method 'POST' to /tasks creates a task; it appears in GET /tasks; after a restart it is still listed; a fetch with method 'DELETE' to /tasks/<id> removes it; after another restart it is still gone. Compare IDs with String(id). Base status assertions on the server source below.",
        "Verified server source for reference only:\n"+server
      ].join("\n\n"),routing);
      const content=composeTaskTestSource(candidate.content);
      const violations=taskTestContractViolations(content);
      if(violations.length)throw new Error("Test contract violation: "+violations.join(" "));
      return {...candidate,content};
    },
    async generateRepairPatch(prompt,routing){
      const response=await core.modelExecution.execute({capability:"coding",routing:routing??{preferLocal:true},maxOutputTokens:1500,input:prompt});
      return{content:response.output,modelId:response.modelId};
    },
    resumeAgent:(missionId,projectId,agentId,approvals,routing)=>core.executeAgentLoop(missionId,projectId,15,approvals,agentId,routing) as never,
    runTool:(projectId,tool,payload,resume)=>runSingleTool(core,projectId,tool,payload,resume).catch(error=>({ok:false,error:(error as Error).message})),
    isApproved:id=>core.executionRuntime.approvals.isApproved(id),
    isRejected:id=>{try{return core.executionRuntime.approvals.isRejected(id);}catch{return false;}},
    forgetApprovalsForMissions:missionIds=>{void core.executionRuntime.forgetApprovalsForMissions(missionIds).catch(()=>undefined);},
    cloudAvailable:cloudReady,
    externalAgent:()=>{const a=pickExternalAgent("auto");return a&&(a.kind==="local"||cloudReady())?{name:a.name,kind:a.kind}:null;},
    openUrl:url=>{if(process.env.LAYANX_OPEN_BROWSER!=="off")openInBrowser(url);}
  };
}
