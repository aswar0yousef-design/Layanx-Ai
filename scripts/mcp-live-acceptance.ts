/**
 * MCP with real servers, end to end, the way the owner and the agent use it:
 *   1. the agent searches the official MCP Registry and requests a server it lacks (Microsoft's Playwright browser server);
 *   2. it stays off until the owner approves it; approval installs the pinned version and connects;
 *   3. a call to one of its tools waits for the owner's approval, then runs and returns a real result;
 *   4. a second, official server added by the owner (the reference memory server) stores a fact and reads it back;
 *   5. a server whose registry entry has no pinned version is refused at approval.
 * It needs the network (registry, npm) and Node with npx. Nothing is written outside a temporary folder.
 *
 *   npx tsx scripts/mcp-live-acceptance.ts
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {McpManager,searchRegistry} from "../src/mcp/manager.js";
import {registerMcpTools} from "../src/mcp/tools.js";
import {runSingleTool} from "../src/autonomy/runtime-deps.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-mcp-live-"));
const checks:{name:string;ok:boolean;detail:string}[]=[];
const check=(name:string,ok:boolean,detail="")=>{checks.push({name,ok,detail:detail.slice(0,300)});console.log((ok?"PASS ":"FAIL ")+name+(detail?" - "+detail.slice(0,200):""));};
const core=new LayanXCore();
// As in the running LayanX (src/runtime.ts): a registered orchestrator whose list names its tools, and an approved
// server's tools are granted to it when the server connects. No wildcard.
core.registerAgent({agentId:"core",purpose:"MCP trial",allowedTools:["mcp.registry.search","mcp.servers.list","mcp.server.request"],forbiddenResources:["secrets","security-controls"],requiredPermission:"L4_EXECUTE",maxToolCalls:100,maxRuntimeMs:120_000,successCriteria:["done"],stopCondition:"stop"});
const manager=new McpManager(core,path.join(dir,"mcp-servers.json"),{timeoutMs:180_000});
registerMcpTools(core,manager);
const agentTool=(name:string,payload:Record<string,unknown>)=>core.toolAdapters.get(name).execute({payload,agentId:"core"} as never) as Promise<Record<string,unknown>>;
/** A tool call as the agent makes it: a dangerous tool first asks the owner, who approves, and then it runs. */
async function callApproved(tool:string,payload:Record<string,unknown>){
  const first=await runSingleTool(core,"mcp-live",tool,payload);
  if(!first.approvalId)return{asked:false,result:first};
  core.executionRuntime.approvals.approve(String(first.approvalId));
  return{asked:true,result:await runSingleTool(core,"mcp-live",tool,payload,{missionId:String(first.missionId),approvalId:String(first.approvalId)})};
}
const text=(r:unknown)=>JSON.stringify(r);

// A local page for the browser to open, so the check does not depend on any outside website.
const page=http.createServer((_q,res)=>{res.writeHead(200,{"content-type":"text/html"});res.end("<title>LayanX MCP check</title><h1>marker-7319</h1>");});
await new Promise<void>(r=>page.listen(0,"127.0.0.1",()=>r()));
const pageUrl=`http://127.0.0.1:${(page.address() as {port:number}).port}/`;

try{
  // 1. Search and request, as the agent does.
  const found=await agentTool("mcp.registry.search",{query:"playwright"}) as {results:Awaited<ReturnType<typeof searchRegistry>>};
  const hit=found.results.find(r=>r.name==="io.github.microsoft/playwright-mcp");
  check("registry search finds Microsoft's Playwright server",Boolean(hit?.suggested),hit?`${hit.name} ${hit.version} -> ${hit.suggested?.command} ${(hit.suggested?.args??[]).join(" ")}`:found.results.map(r=>r.name).join(", "));
  if(!hit)throw new Error("stop: the server to test with was not found");
  const requested=await agentTool("mcp.server.request",{registryName:hit.name,reason:"open web pages in a browser"});
  const id=String(requested.requested);
  const waiting=manager.list().find(s=>s.id===id);
  check("the request stays off until the owner approves",Boolean(waiting)&&!waiting!.approved&&!waiting!.enabled&&!core.tools.list().some(t=>t.name.startsWith(`mcp.${id}.`)),text(requested));

  // 2. Owner approves: the pinned package is installed and connected.
  const t0=Date.now();
  // Headless and isolated, so the check opens no window and uses no profile of the owner's.
  const cfg=JSON.parse(fs.readFileSync(path.join(dir,"mcp-servers.json"),"utf8"));
  cfg.servers.find((s:{id:string})=>s.id===id).args.push("--headless","--isolated");
  fs.writeFileSync(path.join(dir,"mcp-servers.json"),JSON.stringify(cfg));
  const m2=new McpManager(core,path.join(dir,"mcp-servers.json"),{timeoutMs:180_000});
  const approved=await m2.approve(id);
  check("owner approval installs and connects it",approved.connected&&approved.tools.length>0,`${approved.tools.length} tools in ${Math.round((Date.now()-t0)/1000)} s: ${approved.tools.slice(0,6).join(", ")}`);

  // 3. A tool call asks the owner, then runs for real.
  const nav=`mcp.${id}.browser_navigate`;
  const opened=await callApproved(nav,{url:pageUrl});
  const out=text(opened.result);
  check("calling a tool waits for the owner's approval",opened.asked,"");
  check("the tool runs and returns the real page",/marker-7319|LayanX MCP check/.test(out),out.slice(0,200));

  // 4. The official memory server, added by the owner with an exact version.
  m2.add({id:"memory",name:"Memory (reference server)",transport:"stdio",command:"npx",args:["@modelcontextprotocol/server-memory@2.1.1"],env:{MEMORY_FILE_PATH:path.join(dir,"memory.jsonl")}});
  const mem=await m2.approve("memory");
  check("the official memory server connects",mem.connected,mem.tools.join(", "));
  const fact="Yousef prefers replies in Arabic";
  await callApproved("mcp.memory.create_entities",{entities:[{name:"owner",entityType:"person",observations:[fact]}]});
  const back=await callApproved("mcp.memory.read_graph",{});
  check("a fact stored through MCP is read back",text(back.result).includes(fact),text(back.result).slice(0,200));

  // 5. Unpinned versions are refused.
  m2.add({id:"unpinned",name:"unpinned",transport:"stdio",command:"npx",args:["@agent-infra/mcp-server-filesystem@latest"]});
  let refused="";try{await m2.approve("unpinned");}catch(e){refused=e instanceof Error?e.message:String(e);}
  check("a server without an exact version is refused",/Pin an exact version/.test(refused),refused);
  await m2.stop();
}catch(error){
  check("trial finished without an error",false,error instanceof Error?error.message:String(error));
}finally{
  await manager.stop().catch(()=>undefined);
  page.close();
}
const passed=checks.filter(c=>c.ok).length;
const report=path.join(process.env.LOCALAPPDATA??os.tmpdir(),"LayanX","outcome-runs",`mcp-live-${new Date().toISOString().replace(/[:.]/g,"-")}.json`);
fs.mkdirSync(path.dirname(report),{recursive:true});
fs.writeFileSync(report,JSON.stringify({checks,passed,total:checks.length},null,2));
console.log(JSON.stringify({report,passed:`${passed}/${checks.length}`}));
process.exit(passed===checks.length?0:1);
