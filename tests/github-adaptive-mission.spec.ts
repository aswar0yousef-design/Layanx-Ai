import {LayanXCore} from "../src/core/orchestrator.js";
import {createGitHubReadAdapter} from "../src/connectors/github-read.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const plannerOutputs=[
 JSON.stringify({tool:"github.issues.list",action:"list issues",permission:"L1_READ",reason:"inspect issues after repository metadata",payload:{repository:"aswar0yousef-design/Layanx-Ai",limit:5}}),
 "null"
];
let plannerCalls=0;
const provider:ModelProviderAdapter={
 name:"test",
 async health(){return{provider:"test",available:true,updatedAt:new Date().toISOString()};},
 async generate(){return{provider:"test",modelId:"planner",output:plannerOutputs[plannerCalls++]??"null"};}
};
const requests:string[]=[];
const core=new LayanXCore();
core.registerAgent({
 agentId:"core",purpose:"connector adaptive test",
 allowedTools:["github.repo.read","github.issues.list","github.prs.list"],
 forbiddenResources:["secrets","security-controls"],
 requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,
 successCriteria:["done"],stopCondition:"stop"
});
core.models.register({id:"planner",provider:"test",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register(provider);
core.tools.register({name:"github.repo.read",description:"read public GitHub repository metadata",permission:"L1_READ",dangerous:false,actions:["read repository"],tags:["github","repository","read"]});
core.tools.register({name:"github.issues.list",description:"list open GitHub issues for a repository",permission:"L1_READ",dangerous:false,actions:["list issues"],tags:["github","issues","read"]});
const adapter=createGitHubReadAdapter({fetcher:async(input)=>{requests.push(String(input));return new Response(JSON.stringify({items:[]} ),{status:200,headers:{"content-type":"application/json"}});}});
core.toolAdapters.register("github.repo.read",adapter);
core.toolAdapters.register("github.issues.list",adapter);
const mission=core.startMission("Read repository metadata and then inspect its open issues","project-test");
mission.requiredPermission="L1_READ";
mission.steps=[{id:crypto.randomUUID(),description:"Execute repository reads",status:"pending"}];
mission.tools=[{tool:"github.repo.read",action:"read repository",permission:"L1_READ",reason:"initial",payload:{repository:"aswar0yousef-design/Layanx-Ai"}}];
core.missions.save(mission);
const result=await core.executeMissionAdaptive(mission.id,"project-test",3);
if(!result.completed)throw new Error("Connector adaptive mission did not complete.");
if(requests.length!==2)throw new Error("Expected exactly two GitHub requests.");
if(!requests[1]?.includes("/repos/aswar0yousef-design/Layanx-Ai/issues?state=open"))throw new Error("Adaptive payload did not reach GitHub connector.");
if(plannerCalls!==2)throw new Error("Planner did not replan and then stop.");
console.log("Real GitHub connector adaptive execution passed.");
