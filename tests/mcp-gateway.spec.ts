import {McpGateway} from "../src/mcp-gateway.js";
import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({
 agentId:"core",purpose:"MCP test",allowedTools:["runtime.status"],forbiddenResources:[],
 requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:[],stopCondition:"stop"
});
core.startMission("mcp fixture","project-a");
const gateway=new McpGateway(core);

const initialized=await gateway.handle({jsonrpc:"2.0",id:1,method:"initialize"});
if(!initialized||initialized.error||!(initialized.result as {capabilities:{tools:{}}}).capabilities.tools)throw new Error("MCP initialize failed.");

const listed=await gateway.handle({jsonrpc:"2.0",id:2,method:"tools/list"});
const tools=(listed?.result as {tools:Array<{name:string}>}).tools;
if(!tools.some(tool=>tool.name==="runtime.status"))throw new Error("MCP tools/list did not expose allowed tool.");
if(tools.some(tool=>tool.name==="terminal.exec"))throw new Error("MCP tools/list exposed an L4 terminal tool.");

const bad=await gateway.handle({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"runtime.status",arguments:{missionId:"missing",projectId:"project-a",toolIndex:0}}});
if(bad?.error?.code!==-32004)throw new Error("MCP missing mission was not rejected.");

const wrong=await gateway.handle({jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"runtime.status",arguments:{missionId:core.missions.list()[0].id,projectId:"project-a",toolIndex:0}}});
if(wrong?.error?.code!==-32602)throw new Error("MCP unplanned tool call was not rejected.");

console.log("MCP gateway tests passed.");
