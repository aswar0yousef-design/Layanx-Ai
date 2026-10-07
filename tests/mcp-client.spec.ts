import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {McpClient,headerValue} from "../src/mcp/client.js";
import {McpManager,pinnedSpec,resolveCommand,searchRegistry,validateConfig} from "../src/mcp/manager.js";
import {registerMcpTools} from "../src/mcp/tools.js";
import {LayanXCore} from "../src/core/orchestrator.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-mcp-"));
// A tiny stdio MCP server. MODE=legacy answers initialize; MODE=modern answers server/discover and requires _meta.
const serverJs=path.join(dir,"server.mjs");
fs.writeFileSync(serverJs,`
import readline from "node:readline";
const modern=process.env.MODE==="modern";
const send=m=>process.stdout.write(JSON.stringify(m)+"\\n");
const tools=[{name:"echo",description:"Echo text back",inputSchema:{type:"object",properties:{text:{type:"string"}}}},{name:"fail",description:"Always fails"}];
readline.createInterface({input:process.stdin}).on("line",line=>{
  const m=JSON.parse(line);
  if(m.id===undefined)return;
  const meta=m.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
  if(m.method==="server/discover"){
    if(modern)return send({jsonrpc:"2.0",id:m.id,result:{resultType:"complete",supportedVersions:["2026-07-28"],capabilities:{tools:{}},_meta:{"io.modelcontextprotocol/serverInfo":{name:"fake-modern",version:"1"}}}});
    return send({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"Method not found"}});
  }
  if(m.method==="initialize"){
    if(modern)return send({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"use server/discover"}});
    return send({jsonrpc:"2.0",id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"fake-legacy",version:"1"}}});
  }
  if(modern&&meta!=="2026-07-28")return send({jsonrpc:"2.0",id:m.id,error:{code:-32022,message:"Unsupported protocol version",data:{supported:["2026-07-28"]}}});
  if(m.method==="tools/list"){
    // two pages, to exercise pagination
    if(!m.params?.cursor)return send({jsonrpc:"2.0",id:m.id,result:{tools:[tools[0]],nextCursor:"p2"}});
    return send({jsonrpc:"2.0",id:m.id,result:{tools:[tools[1]]}});
  }
  if(m.method==="tools/call"){
    if(m.params.name==="fail")return send({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:"boom"}],isError:true}});
    return send({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:"echo: "+m.params.arguments.text+" ("+(process.env.SECRET_FOR_SERVER??"no-secret")+"|"+(process.env.OTHER_SECRET??"isolated")+")"}]}});
  }
  send({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"Method not found"}});
});`);

const stdio=(mode:string)=>new McpClient({transport:"stdio",stdio:{command:process.execPath,args:[serverJs],env:{PATH:process.env.PATH,MODE:mode}}},5000);

// 1. Legacy server: probe fails, initialize handshake, paginated tools, tool errors.
const legacy=stdio("legacy");await legacy.connect();
assert.equal(legacy.era,"legacy");assert.equal(legacy.protocolVersion,"2025-11-25");assert.equal(legacy.serverInfo.name,"fake-legacy");
assert.deepEqual((await legacy.listTools()).map(t=>t.name),["echo","fail"]);
assert.equal((await legacy.callTool("echo",{text:"مرحبا"})).text,"echo: مرحبا (no-secret|isolated)");
assert.equal((await legacy.callTool("fail",{})).isError,true);
await legacy.close();

// 2. Modern server: server/discover selects 2026-07-28 and every request carries _meta.
const modern=stdio("modern");await modern.connect();
assert.equal(modern.era,"modern");assert.equal(modern.protocolVersion,"2026-07-28");
assert.equal((await modern.callTool("echo",{text:"hi"})).text,"echo: hi (no-secret|isolated)");
await modern.close();

// 3. Streamable HTTP legacy server: session id, protocol header, SSE replies.
const seen:Array<Record<string,string|undefined>>=[];
const httpServer=http.createServer((req,res)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{
  const m=JSON.parse(body||"{}");seen.push({method:m.method,session:req.headers["mcp-session-id"] as string|undefined,version:req.headers["mcp-protocol-version"] as string|undefined});
  if(m.method==="server/discover"){res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32000,message:"Bad Request: Server not initialized"}}));return;}
  if(m.method==="initialize"){res.writeHead(200,{"content-type":"application/json","mcp-session-id":"sess-1"});res.end(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{protocolVersion:"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"http-legacy"}}}));return;}
  if(!m.id){res.writeHead(202);res.end();return;}
  if(m.method==="tools/list"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{tools:[{name:"time"}]}}));return;}
  res.writeHead(200,{"content-type":"text/event-stream"});
  res.end(`event: message\ndata: ${JSON.stringify({jsonrpc:"2.0",method:"notifications/progress",params:{progress:1}})}\n\nevent: message\ndata: ${JSON.stringify({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:"12:00"}]}})}\n\n`);
});});
await new Promise<void>(r=>httpServer.listen(0,"127.0.0.1",()=>r()));
const url=`http://127.0.0.1:${(httpServer.address() as any).port}/mcp`;
const remote=new McpClient({transport:"http",http:{url}},5000);
await remote.connect();
assert.equal(remote.era,"legacy");assert.equal(remote.protocolVersion,"2025-06-18");
assert.deepEqual((await remote.listTools()).map(t=>t.name),["time"]);
assert.equal((await remote.callTool("time",{})).text,"12:00","SSE reply parsed, progress skipped");
const after=seen.filter(s=>s.method==="tools/call")[0]!;
assert.equal(after.session,"sess-1");assert.equal(after.version,"2025-06-18");
await remote.close();httpServer.close();
await assert.rejects(new McpClient({transport:"http",http:{url:"http://example.com/mcp"}}).connect(),/https/);
assert.equal(headerValue("get_weather"),"get_weather");assert.equal(headerValue("طقس"),"=?base64?"+Buffer.from("طقس").toString("base64")+"?=");

// 4. Manager: pinned versions, approval, namespaced dangerous tools, secrets only where listed.
assert.equal(pinnedSpec({transport:"stdio",command:"npx",args:["@playwright/mcp@latest"]}),null);
assert.equal(pinnedSpec({transport:"stdio",command:"npx",args:["-y","@playwright/mcp@0.0.68"]}),"@playwright/mcp@0.0.68");
assert.equal(pinnedSpec({transport:"stdio",command:"uvx",args:["mcp-server-git==2025.1.14"]}),"mcp-server-git==2025.1.14");
assert.equal(pinnedSpec({transport:"stdio",command:"docker",args:["run","-i","--rm","mcp/fetch:latest"]}),null);
assert.throws(()=>validateConfig({id:"x1",command:"C:\\\\evil\\\\run.cmd"}),/never \.cmd/);
assert.throws(()=>validateConfig({id:"x1",command:"node",env:{API_KEY:"abc"}}),/secrets/);
assert.throws(()=>validateConfig({id:"x1",transport:"http",url:"http://example.com/mcp"}),/https/);
if(process.platform==="win32"||fs.existsSync(path.join(path.dirname(process.execPath),"node_modules","npm","bin","npx-cli.js")))
  assert.equal(resolveCommand({id:"a",name:"a",transport:"stdio",command:"npx",args:["pkg@1.0.0"],enabled:true,approved:true,addedAt:""}).command,process.execPath,"npx runs through node, never npx.cmd");

process.env.SECRET_FOR_SERVER="s3cret";process.env.OTHER_SECRET="must-not-leak";
const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"t",allowedTools:["runtime.status"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
const manager=new McpManager(core,path.join(dir,"mcp-servers.json"));
manager.add({id:"fake",name:"Fake server",command:"node",args:[serverJs],envFromSecrets:["SECRET_FOR_SERVER"],env:{MODE:"legacy"}});
assert.equal(manager.list()[0]!.approved,false,"new servers wait for the owner");
await manager.approve("fake");
const status=manager.list()[0]!;
assert.deepEqual(status.tools.sort(),["mcp.fake.echo","mcp.fake.fail"]);
assert.equal(core.tools.get("mcp.fake.echo").dangerous,true,"MCP tools need approval by default");
assert.ok(core.agents.get("core").allowedTools.includes("mcp.fake.echo"));
const out=await core.toolAdapters.get("mcp.fake.echo").execute({payload:{text:"hi"}} as any) as any;
assert.equal(out.text,"echo: hi (s3cret|isolated)","only the listed secret reaches the server");
await assert.rejects(core.toolAdapters.get("mcp.fake.fail").execute({payload:{}} as any) as Promise<unknown>,/boom/);
await manager.setSafeTools("fake",["echo"]);
assert.equal(core.tools.get("mcp.fake.echo").dangerous,false,"owner-marked safe tool");
assert.equal(core.tools.get("mcp.fake.echo").permission,"L2_ANALYZE");
await manager.disable("fake");
assert.equal(core.tools.has("mcp.fake.echo"),false,"disabled server's tools disappear");
assert.ok(!core.agents.get("core").allowedTools.includes("mcp.fake.echo"));
const reloaded=new McpManager(core,path.join(dir,"mcp-servers.json"));
assert.equal(reloaded.list()[0]!.approved,true,"config persisted");
delete process.env.SECRET_FOR_SERVER;delete process.env.OTHER_SECRET;

// 5. Registry search -> pinned suggestions; agent can only *request*.
const registryFetch=(async(u:string)=>{
  assert.match(String(u),/\/v0\.1\/servers\?search=[^&]+&version=latest/);
  return new Response(JSON.stringify({servers:[
    {server:{name:"io.github.acme/postgres",description:"Query Postgres",version:"1.4.0",packages:[{registryType:"npm",identifier:"@acme/postgres-mcp",version:"1.4.0",transport:{type:"stdio"},environmentVariables:[{name:"DATABASE_URL",isSecret:true,isRequired:true}]}]}},
    {server:{name:"io.github.acme/pyserver",version:"0.3.1",packages:[{registryType:"pypi",identifier:"acme-mcp",version:"0.3.1"}]}},
    {server:{name:"com.example/remote",version:"2.0.0",remotes:[{type:"streamable-http",url:"https://mcp.example.com/mcp"}]}}]}),{status:200});
}) as unknown as typeof fetch;
const results=await searchRegistry("postgres",{fetcher:registryFetch});
assert.deepEqual(results[0]!.suggested!.args,["@acme/postgres-mcp@1.4.0"]);assert.deepEqual(results[0]!.secrets,["DATABASE_URL"]);
assert.deepEqual(results[1]!.suggested!.args,["acme-mcp==0.3.1"]);assert.equal(results[1]!.suggested!.command,"uvx");
assert.equal(results[2]!.suggested!.url,"https://mcp.example.com/mcp");
registerMcpTools(core,manager,{fetcher:registryFetch});
const requested=await core.toolAdapters.get("mcp.server.request").execute({agentId:"core",payload:{registryName:"io.github.acme/postgres",reason:"need DB access"}} as any) as any;
assert.match(requested.status,/owner's approval/);
const pending=manager.list().find(s=>s.id===requested.requested)!;
assert.equal(pending.approved,false);assert.equal(pending.requestedBy,"core");assert.deepEqual(pending.envFromSecrets,["DATABASE_URL"]);
await manager.stop();
fs.rmSync(dir,{recursive:true,force:true});
console.log("mcp-client: legacy + modern stdio, Streamable HTTP with SSE, manager approvals, secrets isolation and registry requests verified");
process.exit(0);
