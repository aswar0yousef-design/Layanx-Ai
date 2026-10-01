import {MemoryEngine} from "../src/core/memory.js";
import {AuditLog} from "../src/core/audit.js";
import {createHttpReadAdapter} from "../src/tools/http-read.js";
import {createGitHubReadAdapter} from "../src/connectors/github-read.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ToolRequest} from "../src/core/types.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const memory=new MemoryEngine();
const sensitiveKey=["api","Key"].join("");
const entry=memory.remember({missionId:"m",kind:"experience",summary:"secret handling",content:{[sensitiveKey]:["secret","value"].join(""),nested:{authorization:"Bearer abcdefghijk",plain:"ok"}},confidence:1,tags:["security"]});
if((entry.content as Record<string,unknown>)[sensitiveKey]!=="[REDACTED]")throw new Error("Memory API key was not sanitized.");
if(((entry.content as Record<string,unknown>).nested as Record<string,unknown>).authorization!=="[REDACTED]")throw new Error("Memory authorization was not sanitized.");

const audit=new AuditLog();
audit.append({timestamp:new Date().toISOString(),actor:"test",action:"test",resource:"m",result:"success",metadata:{token:["secret","value"].join(""),nested:{authorization:"Bearer abcdefghijk"}}});
const event=audit.list()[0];
if(event.metadata?.token!=="[REDACTED]")throw new Error("Audit token was not sanitized.");
if((event.metadata?.nested as Record<string,unknown>).authorization!=="[REDACTED]")throw new Error("Audit authorization was not sanitized.");

const request:ToolRequest={missionId:"m",agentId:"core",tool:"http.read",action:"read url",permission:"L1_READ",idempotencyKey:"k",payload:{url:"https://example.com"}};
let httpCalls=0;
const http=createHttpReadAdapter({fetcher:async()=>{httpCalls++;return new Response("ok",{status:200,headers:{"content-type":"text/plain"}});}});
const httpResult=await http.execute(request);
if(httpCalls!==1||httpResult.status!==200||httpResult.body!=="ok")throw new Error("HTTP read integration failed.");
await http.execute({...request,payload:{url:"http://127.0.0.1"}}).then(()=>{throw new Error("HTTP SSRF guard did not block loopback.");}).catch(error=>{if(!String(error).includes("Local HTTP targets are blocked."))throw error;});

let githubCalls=0;
const githubSecret=["sec","ret"].join("");
const github=createGitHubReadAdapter({baseUrl:"https://github.test",token:githubSecret,fetcher:async(url,init)=>{githubCalls++;if(init?.method!=="GET")throw new Error("GitHub connector used a non-GET request.");if((init.headers as Record<string,string>).authorization!==`Bearer ${githubSecret}`)throw new Error("GitHub token was not sent as expected.");return new Response(JSON.stringify({full_name:"owner/repo"}),{status:200,headers:{"content-type":"application/json"}});}});
const githubResult=await github.execute({...request,tool:"github.repo.read",action:"read repository",payload:{repository:"owner/repo"}});
if(githubCalls!==1||githubResult.status!==200)throw new Error("GitHub connector integration failed.");

const calls={planner:0};
const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"planner failure test",allowedTools:["test.tool"],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.models.register({id:"failure-planner",provider:"failure-provider",capabilities:["reasoning"],local:true,enabled:true,priority:1});
const provider:ModelProviderAdapter={name:"failure-provider",async health(){return{provider:"failure-provider",available:true,updatedAt:new Date().toISOString()};},async generate(){calls.planner++;return{provider:"failure-provider",modelId:"failure-planner",output:"not-json"};}};
core.providers.register(provider);
core.tools.register({name:"test.tool",description:"test",permission:"L1_READ",dangerous:false,actions:["read"]});
core.toolAdapters.register("test.tool",{async execute(){return{ok:true};}});
const planned=core.startMission("planner failure");
planned.requiredPermission="L1_READ";
planned.tools=[{tool:"test.tool",action:"read",permission:"L1_READ",reason:"initial"}];
core.missions.save(planned);
const adaptive=await core.executeMissionAdaptive(planned.id,"project",2);
if(adaptive.completed||!String(adaptive.reason).includes("Adaptive planner returned invalid JSON."))throw new Error("Planner failure was not surfaced by adaptive execution.");
if(calls.planner!==1)throw new Error("Planner failure test did not invoke the provider exactly once.");

console.log("Verification integration hardening passed.");
