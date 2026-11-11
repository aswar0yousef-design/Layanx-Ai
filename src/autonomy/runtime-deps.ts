import {randomUUID} from "node:crypto";
import type {LayanXCore} from "../core/orchestrator.js";
import {patientCall} from "../core/patient-call.js";
import {cloudPolicy} from "../config/providers.js";
import {pickExternalAgent} from "./external-agents.js";
import type {JobRouting,SupervisorDeps,ToolRun} from "./supervisor.js";
import {ollamaModelLadders} from "../config/providers.js";
import {openInBrowser} from "../platform/open-url.js";
import {abortProjectRuns} from "./project-runner.js";
import {projectDir} from "./project-dir.js";
import {researchTask} from "./task-research.js";
import {composeTaskServer,composeTaskTestSource,decomposeTaskServer,TASK_TEST_HARNESS,taskTestContractViolations} from "./task-app-verifier.js";

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
  const generateSource=async(input:string,routing?:JobRouting)=>{
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
        routing:opts.cloud?{preferLocal:false}:opts.model?{preferLocal:true,modelId:opts.model}:{preferLocal:true}
      });
      return r.output;
    },
    researchTask(goal,projectId,stack){
      const think=async(prompt:string)=>(await core.modelExecution.execute({capability:"reasoning",input:prompt,maxOutputTokens:1500,routing:{preferLocal:true}})).output;
      return researchTask({goal,projectId,...(stack?{stack}:{})},{think});
    },
    runAgent:(goal,projectId,agentId,routing)=>core.runAgentGateway(goal,projectId,15,{},agentId,routing) as never,
    async generateTaskServer(goal,previous,routing){
      const parts=previous?decomposeTaskServer(previous):undefined;
      const response=await core.modelExecution.execute({
        capability:"coding",routing:routing??{preferLocal:true},maxOutputTokens:3000,
        responseSchema:{type:"object",properties:{routes:{type:"string"},browser:{type:"string"}},required:["routes","browser"],additionalProperties:false},
        input:[
          "Return a JSON object with two strings: routes and browser. No markdown, imports, HTML, stubs or TODOs. Write normal multi-line code in each.",
          goal,
          "LayanX writes the rest of src/server.mjs. Already defined: req, res, route (the path without the query), page (the finished HTML), loadTasks() returning a plain array, saveTasks(array), readBody(req) returning a promise of the text, json(res,status,value). GET /health is already handled.",
          "routes: Node statements inside the async request handler, each an if statement ending in return. GET / : res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(page). GET /tasks returns json(res,200,{tasks:loadTasks()}). POST /tasks parses await readBody(req), pushes {id:String(Date.now()),title} and saves, then returns the task with status 201. DELETE when route starts with /tasks/: id is decodeURIComponent(route.slice(7)), keep tasks whose String(task.id) differs, save, return json(res,200,{deleted:true}). document and window do not exist here.",
          "browser: the JavaScript of the page, which already has input#title, button#add and ul#list. Load rows from GET /tasks, set titles with textContent, give each row a button labelled Delete / حذف that sends fetch('/tasks/'+task.id,{method:'DELETE'}), and make #add POST the title as JSON and reload the rows.",
          parts?"Your previous parts, which failed; return them corrected and complete:\nroutes:\n"+parts.routes+"\nbrowser:\n"+parts.browser:""
        ].filter(Boolean).join("\n\n")
      });
      const output=JSON.parse(response.output) as {routes?:unknown;browser?:unknown}|null;
      if(typeof output?.routes!=="string"||typeof output?.browser!=="string")throw new Error("Unusable output: routes or browser code is missing.");
      return{content:composeTaskServer(output.routes,output.browser),modelId:response.modelId};
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
    modelLadders(){
      const ladders=ollamaModelLadders(process.env.LAYANX_OLLAMA_MODEL_LADDER);
      if(!ladders)return undefined;
      const known=new Set(core.models.list().filter(m=>m.enabled).map(m=>m.id));
      return{...ladders,coding:ladders.coding.filter(id=>known.has(id)),planning:ladders.planning.filter(id=>known.has(id))};
    },
    async generateRepairPatch(prompt,routing){
      const response=await patientCall(timeoutMs=>core.modelExecution.execute({capability:"coding",routing:routing??{preferLocal:true},maxOutputTokens:1500,input:prompt,...(timeoutMs?{timeoutMs}:{})}));
      return{content:response.output,modelId:response.modelId};
    },
    async generateFile(prompt,routing,schema){
      const response=await patientCall(timeoutMs=>core.modelExecution.execute({capability:"coding",routing:routing??{preferLocal:true},maxOutputTokens:4000,input:prompt,...(schema?{responseSchema:schema}:{}),...(timeoutMs?{timeoutMs}:{})}));
      return{content:response.output,modelId:response.modelId};
    },
    resumeAgent:(missionId,projectId,agentId,approvals,routing)=>core.executeAgentLoop(missionId,projectId,15,approvals,agentId,routing) as never,
    runTool:(projectId,tool,payload,resume)=>runSingleTool(core,projectId,tool,payload,resume).catch(error=>({ok:false,error:(error as Error).message})),
    isApproved:id=>core.executionRuntime.approvals.isApproved(id),
    isRejected:id=>{try{return core.executionRuntime.approvals.isRejected(id);}catch{return false;}},
    forgetApprovalsForMissions:missionIds=>{void core.executionRuntime.forgetApprovalsForMissions(missionIds).catch(()=>undefined);},
    cloudAvailable:cloudReady,
    externalAgent:()=>{const a=pickExternalAgent("auto");return a&&(a.kind==="local"||cloudReady())?{name:a.name,kind:a.kind}:null;},
    openUrl:url=>{if(process.env.LAYANX_OPEN_BROWSER!=="off")openInBrowser(url);},
    activity:projectId=>core.lastProjectActivity(projectId),
    async abortProject(projectId,reason){abortProjectRuns(projectDir(projectId));await core.stopProjectMissions(projectId,reason);}
  };
}
