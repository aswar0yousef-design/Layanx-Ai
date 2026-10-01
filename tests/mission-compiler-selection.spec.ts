import {AiMissionPlanner} from "../src/core/ai-planner.js";
import {MissionCompiler} from "../src/core/mission-compiler.js";
import {ToolSelector} from "../src/core/tool-selection.js";
import {ToolRegistry} from "../src/tools/registry.js";
import type {ModelExecutionRouter} from "../src/core/model-execution.js";

const planned={risk:"high" as const,requiredPermission:"L4_EXECUTE" as const,steps:[{description:"Read repository files"},{description:"Run a deployment command"}],successCriteria:["deployment completes"],stopCondition:"Stop on policy denial"};
const mission=new MissionCompiler().compile(planned,"Deploy the repository");
if(mission.requiredPermission!=="L4_EXECUTE"||mission.risk!=="high"||mission.steps.length!==2)throw new Error("Mission compiler failed.");

const tools=new ToolRegistry();
tools.register({name:"files.read",description:"Read repository files",permission:"L1_READ",dangerous:false});
tools.register({name:"terminal.run",description:"Run deployment command",permission:"L4_EXECUTE",dangerous:true});
tools.register({name:"payments.transfer",description:"Transfer payment",permission:"L5_CRITICAL",dangerous:true});
const selector=new ToolSelector(tools);
const contract={agentId:"ops",purpose:"deploy",allowedTools:["files.read","terminal.run","payments.transfer"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["deployment completes"],stopCondition:"stop"};
const selected=selector.select("run deployment command",contract,"L4_EXECUTE");
if(selected[0]?.tool.name!=="terminal.run")throw new Error("Tool selector chose the wrong tool.");
const bounded=selector.select("transfer payment",contract,"L5_CRITICAL");
if(bounded.some(item=>item.tool.name==="payments.transfer"))throw new Error("Tool selector exceeded the agent permission ceiling.");
console.log("Mission compiler and tool selection test passed.");
