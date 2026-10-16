import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-platforms-"));
process.env.LAYANX_STORE_DIR=root;
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"ws");
const {PLATFORMS,PLATFORM_SECRETS}=await import("../src/platforms/catalog.js");
const {collectFiles,registerVercelTools,VERCEL_TOOLS}=await import("../src/platforms/vercel.js");
const {connectPlatform,disconnectPlatform,platformFor,platformServerCopies,platformStatuses,registerPlatformTools}=await import("../src/platforms/connect.js");
const {McpManager,validateConfig,pinnedSpec}=await import("../src/mcp/manager.js");
const {LayanXCore}=await import("../src/core/orchestrator.js");
const {KNOWN_SECRETS}=await import("../src/local/setup-routes.js");
const {trustAllows}=await import("../src/autonomy/trust.js");

// ---------- 1. the catalog: one entry per platform, every server pinned and valid ----------
{
  const ids=PLATFORMS.map(p=>p.id);
  assert.deepEqual(ids,[...new Set(ids)]);
  for(const name of ["github","vercel","hostinger","cloudflare","netlify","supabase","context7","claude"])assert.ok(ids.includes(name as never),name);
  const mcpIds=PLATFORMS.filter(p=>p.mcp).map(p=>p.mcp!.id);
  assert.deepEqual(mcpIds,[...new Set(mcpIds)]);
  for(const p of PLATFORMS.filter(x=>x.mcp)){
    const c=validateConfig(p.mcp);
    assert.ok(pinnedSpec(c),p.id+" is pinned to an exact version");
    assert.ok((c.safeTools??[]).length>0,p.id+" lists its read-only tools");
    for(const s of c.envFromSecrets??[])assert.ok(p.secrets.some(x=>x.name===s),p.id+" passes only its own secret "+s);
    if(c.transport==="http")assert.match(c.url!,/^https:\/\//);
  }
  for(const s of PLATFORM_SECRETS)assert.ok(KNOWN_SECRETS.includes(s),s+" is a known secret on the setup page");
  assert.equal(KNOWN_SECRETS.filter(n=>n==="GITHUB_TOKEN").length,1,"GitHub keeps its one token");
  assert.ok(PLATFORMS.find(p=>p.id==="github")!.secrets[0]!.shared);
  assert.equal(PLATFORMS.find(p=>p.id==="vercel")!.mcp,undefined,"Vercel's MCP admits only approved clients: LayanX uses its REST API");
  // a second copy of a platform server is recognised, whatever its id or version
  assert.equal(platformFor({source:{package:"@hostinger/mcp"},args:["-p","@hostinger/mcp@2.0.0","hostinger-api-mcp"]})?.id,"hostinger");
  assert.equal(platformFor({args:["-y","@supabase/mcp-server-supabase@0.9.0"]})?.id,"supabase");
  assert.equal(platformFor({url:"https://MCP.cloudflare.com/mcp/"})?.id,"cloudflare");
  assert.equal(platformFor({url:"not a url"}),undefined);
  assert.equal(platformFor({args:["@acme/other-mcp@1.0.0"]}),undefined);
}

// ---------- 2. Vercel through its REST API ----------
type Call={method:string;url:string;headers:Record<string,string>;body?:unknown};
const calls:Call[]=[];
let missingOnce=true;
const sha=(s:string)=>crypto.createHash("sha1").update(s).digest("hex");
const fakeVercel:typeof fetch=async(input,init)=>{
  const url=String(input);const method=init?.method??"GET";const headers=Object.fromEntries(Object.entries(init?.headers??{}).map(([k,v])=>[k.toLowerCase(),String(v)]));
  let body:unknown=init?.body;if(typeof body==="string")body=JSON.parse(body);else if(body instanceof Blob)body=Buffer.from(await body.arrayBuffer()).toString("utf8");
  calls.push({method,url,headers,body});
  const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
  if(headers.authorization!=="Bearer vt_test")return json(403,{error:{code:"forbidden",message:"Not authorized"}});
  const u=new URL(url);
  if(u.pathname==="/v10/projects")return json(200,{projects:[{id:"prj_1",name:"shop",framework:"nextjs",alias:[{domain:"shop.example.com"}],targets:{production:{url:"shop.vercel.app"}},updatedAt:1}]});
  if(u.pathname==="/v13/deployments"&&method==="POST"){
    const files=(body as {files:Array<{sha:string}>}).files;
    if(missingOnce){missingOnce=false;return json(400,{error:{code:"missing_files",message:"Missing files",missing:[files[0]!.sha]}});}
    return json(200,{id:"dpl_new",url:"shop-abc.vercel.app",readyState:"QUEUED",inspectorUrl:"https://vercel.com/i/dpl_new"});
  }
  if(u.pathname==="/v2/files")return json(200,{});
  if(u.pathname==="/v13/deployments/dpl_ready")return json(200,{id:"dpl_ready",url:"shop-ready.vercel.app",readyState:"READY",projectId:"prj_1"});
  if(u.pathname==="/v13/deployments/dpl_err")return json(200,{id:"dpl_err",url:"shop-err.vercel.app",readyState:"ERROR",projectId:"prj_1",errorMessage:"Command failed"});
  if(u.pathname==="/v3/deployments/dpl_err/events")return json(200,[{type:"stdout",created:2,payload:{text:"Compiled"}},{type:"stderr",created:1,payload:{text:"Module not found: ./Header"}}]);
  if(u.pathname.startsWith("/v10/projects/prj_1/promote/"))return json(200,{});
  if(u.pathname==="/v6/deployments")return json(200,{deployments:[{uid:"dpl_ready",url:"shop-ready.vercel.app",state:"READY",target:"production",created:5}]});
  return json(404,{error:{code:"not_found",message:"no route "+u.pathname}});
};
{
  const ws=path.join(root,"ws","shop");
  fs.mkdirSync(path.join(ws,"node_modules","x"),{recursive:true});fs.mkdirSync(path.join(ws,"drafts"),{recursive:true});fs.mkdirSync(path.join(ws,"public"),{recursive:true});
  fs.writeFileSync(path.join(ws,"package.json"),JSON.stringify({name:"@me/Shop Site"}));
  fs.writeFileSync(path.join(ws,"index.html"),"<h1>shop</h1>");
  fs.writeFileSync(path.join(ws,"public","logo.svg"),"<svg/>");
  for(const f of [".env",".env.local","server.pem","id_rsa",".npmrc","node_modules/x/i.js","drafts/a.md","notes.log"])fs.writeFileSync(path.join(ws,f),"secret");
  fs.writeFileSync(path.join(ws,".vercelignore"),"drafts\n*.log\n");
  const files=collectFiles(ws).map(f=>f.file).sort();
  assert.deepEqual(files,[".vercelignore","index.html","package.json","public/logo.svg"],"secrets, keys, dependencies and ignored files never leave this PC");

  const env:NodeJS.ProcessEnv={LAYANX_WORKSPACE_ROOT:path.join(root,"ws")};
  const core=new LayanXCore();
  registerVercelTools(core,{fetcher:fakeVercel,env});
  const run=(tool:string,payload:unknown,projectId="shop")=>core.toolAdapters.get(tool)!.execute({missionId:"m",agentId:"coder",projectId,tool,action:tool,permission:"L4_EXECUTE",idempotencyKey:"k",payload});
  await assert.rejects(run("vercel.projects.list",{}),/vercel_not_connected/,"no token: the agent is told to ask the owner");
  env.VERCEL_TOKEN="vt_test";
  const listed=await run("vercel.projects.list",{}) as any;
  assert.deepEqual(listed.projects[0],{id:"prj_1",name:"shop",framework:"nextjs",domains:["shop.example.com"],production:"https://shop.vercel.app",updatedAt:1});
  env.VERCEL_TEAM_ID="team_abc";
  calls.length=0;
  const deployed=await run("vercel.deploy",{}) as any;
  assert.equal(deployed.url,"https://shop-abc.vercel.app");assert.equal(deployed.state,"QUEUED");assert.equal(deployed.project,"shop-site");
  const creates=calls.filter(c=>c.url.includes("/v13/deployments")),uploads=calls.filter(c=>c.url.includes("/v2/files"));
  assert.equal(creates.length,2,"created, told which files are missing, created again");
  assert.equal(uploads.length,1,"only the missing file is uploaded");
  assert.equal(uploads[0]!.headers["x-vercel-digest"],(creates[0]!.body as any).files[0].sha);
  assert.ok(creates.every(c=>(c.body as any).target===undefined),"always a preview, never production");
  assert.ok(calls.every(c=>c.url.includes("teamId=team_abc")),"the team applies to every call");
  assert.ok(!JSON.stringify(creates[1]!.body).includes(".env"));
  assert.equal(sha("<h1>shop</h1>"),(creates[1]!.body as any).files.find((f:any)=>f.file==="index.html").sha);
  await assert.rejects(run("vercel.deploy",{dir:"../.."}),/inside the project|not a folder/);
  const failed=await run("vercel.deployments.list",{deploymentId:"dpl_err"}) as any;
  assert.equal(failed.deployment.state,"ERROR");assert.deepEqual(failed.errors.map((e:any)=>e.text),["Module not found: ./Header"]);
  await assert.rejects(run("vercel.promote",{deploymentId:"dpl_err",project:"prj_1"}),/only a READY deployment/);
  const promoted=await run("vercel.promote",{deploymentId:"dpl_ready"}) as any;
  assert.equal(promoted.promoted,"dpl_ready");assert.ok(calls.some(c=>c.method==="POST"&&c.url.includes("/v10/projects/prj_1/promote/dpl_ready")));
  await assert.rejects(run("vercel.deployments.list",{deploymentId:"../x"}),/deploymentId is required/);
  // approvals: production always waits; a preview may run alone only in a trusted project
  const def=(n:string)=>core.tools.list().find(t=>t.name===n)!;
  assert.deepEqual(VERCEL_TOOLS.map(n=>[n,def(n).dangerous,def(n).permission]),[["vercel.projects.list",false,"L1_READ"],["vercel.deployments.list",false,"L1_READ"],["vercel.deploy",true,"L3_MODIFY"],["vercel.promote",true,"L4_EXECUTE"]]);
  const trustFile=path.join(root,"trust.json");fs.writeFileSync(trustFile,JSON.stringify({shop:"full",other:"trusted"}));
  const tenv={LAYANX_TRUST_FILE:trustFile};
  assert.equal(trustAllows("vercel.deploy","other",tenv),true);
  assert.equal(trustAllows("vercel.promote","shop",tenv),false,"production never runs without the owner");
  assert.equal(trustAllows("vercel.deploy","nobody",tenv),false);
}

// ---------- 3. connecting: the secret store, the existing MCP manager, no second copies ----------
{
  const serverJs=path.join(root,"fake-mcp.mjs");
  fs.writeFileSync(serverJs,`
import readline from "node:readline";
const send=m=>process.stdout.write(JSON.stringify(m)+"\\n");
readline.createInterface({input:process.stdin}).on("line",line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;
  if(m.method==="server/discover")return send({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"nope"}});
  if(m.method==="initialize")return send({jsonrpc:"2.0",id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"fake",version:"1"}}});
  if(m.method==="tools/list")return send({jsonrpc:"2.0",id:m.id,result:{tools:[{name:"list_sites",description:"List sites"},{name:"delete_site",description:"Delete a site"}]}});
  if(m.method==="tools/call")return send({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:(process.env.FAKE_PLATFORM_TOKEN??"none")+"|"+(process.env.VERCEL_TOKEN??"isolated")}]}});
  send({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"no"}});
});`);
  const catalog=[{id:"fakehost",label:"FakeHost",category:"hosting",via:["mcp"],about:{ar:"تجربة",en:"test"},docs:"https://example.com",tools:[],
    secrets:[{name:"FAKE_PLATFORM_TOKEN",createUrl:"https://example.com/tokens",scopes:{ar:"-",en:"-"}}],
    mcp:{id:"fakehost",name:"FakeHost",transport:"stdio",command:"node",args:[serverJs],envFromSecrets:["FAKE_PLATFORM_TOKEN"],safeTools:["list_sites"],source:{package:"@fake/host-mcp",version:"1.0.0"}}},
    ...PLATFORMS.filter(p=>p.id==="vercel"||p.id==="claude"||p.id==="github")] as any[];
  const core=new LayanXCore();
  for(const id of ["core","coder"])core.registerAgent({agentId:id,purpose:"t",allowedTools:[],forbiddenResources:["secrets"],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:1000,successCriteria:["d"],stopCondition:"s"});
  const mcp=new McpManager(core,path.join(root,"mcp-servers.json"),{agents:["core","coder"],timeoutMs:10_000});
  const secrets=new Map<string,string>();
  const store={names:()=>[...secrets.keys()],async set(n:string,v:string){secrets.set(n,v);},async delete(n:string){return secrets.delete(n);}};
  // The MCP manager reads this process's environment, exactly as in LayanX.
  const env=process.env;env.VERCEL_TOKEN="must-not-leak";
  let restart=0;
  const deps={store,mcp,env,catalog,fetcher:fakeVercel,onSharedSecretChanged:()=>{restart++;},toolNames:()=>core.tools.list().map(t=>t.name)};
  // an earlier, hand-added copy of the same server (other id, other version)
  mcp.add({id:"fake-old",name:"old copy",transport:"stdio",command:"npx",args:["@fake/host-mcp@0.9.0"],source:{package:"@fake/host-mcp"}});
  assert.deepEqual(platformServerCopies(mcp.list(),catalog[0]),["fake-old"]);
  assert.equal(platformStatuses(deps).find(s=>s.id==="fakehost")!.state,"needs_token");
  await assert.rejects(connectPlatform("fakehost",{},deps),/Paste the FAKE_PLATFORM_TOKEN/);
  await assert.rejects(connectPlatform("fakehost",{FAKE_PLATFORM_TOKEN:"has spaces in it"},deps),/paste only the token/);
  const r=await connectPlatform("fakehost",{FAKE_PLATFORM_TOKEN:"fk_123"},deps);
  assert.equal(r.status.state,"connected",JSON.stringify(r.status));assert.deepEqual(r.replaced,["fake-old"],"the old copy is replaced, not kept beside it");
  assert.deepEqual(mcp.list().map(s=>s.id),["fakehost"]);
  assert.equal(secrets.get("FAKE_PLATFORM_TOKEN"),"fk_123");assert.equal(env.FAKE_PLATFORM_TOKEN,"fk_123","usable at once, no restart");
  const safe=core.tools.list().find(t=>t.name==="mcp.fakehost.list_sites")!,danger=core.tools.list().find(t=>t.name==="mcp.fakehost.delete_site")!;
  assert.equal(safe.dangerous,false);assert.equal(danger.dangerous,true,"deleting waits for the owner");
  for(const a of ["core","coder"])assert.ok(core.agents.get(a)!.allowedTools.includes("mcp.fakehost.delete_site"),a+" may use it (with approval)");
  // the server receives its own token and nothing else
  const out=await core.toolAdapters.get("mcp.fakehost.list_sites")!.execute({missionId:"m",agentId:"coder",tool:"x",action:"x",permission:"L2_ANALYZE",idempotencyKey:"k",payload:{}}) as any;
  assert.equal(out.text,"fk_123|isolated");
  // connecting again does not add a second server
  await connectPlatform("fakehost",{},deps);assert.equal(mcp.list().length,1);
  // Vercel: the token is checked with Vercel before it is saved
  await assert.rejects(connectPlatform("vercel",{VERCEL_TOKEN:"wrong"},deps),/rejected this token \(HTTP 403\)/);
  assert.equal(secrets.has("VERCEL_TOKEN"),false,"a rejected token is never stored");
  const realUser:typeof fetch=async(i,init)=>String(i).endsWith("/v2/user")?new Response("{}",{status:new Headers(init?.headers).get("authorization")==="Bearer vt_ok"?200:401}):fakeVercel(i,init);
  const v=await connectPlatform("vercel",{VERCEL_TOKEN:"vt_ok"},{...deps,fetcher:realUser});
  assert.equal(v.status.state,"connected");assert.equal(restart,0,"Vercel's token is read when used: no restart");
  await assert.rejects(connectPlatform("claude",{ANTHROPIC_API_KEY:"x"},deps),/setup page/,"Claude is managed in one place only");
  // the agent's view
  registerPlatformTools(core,()=>({mcp,env,catalog,toolNames:()=>core.tools.list().map(t=>t.name)}));
  const view=await core.toolAdapters.get("platforms.list")!.execute({missionId:"m",agentId:"core",tool:"platforms.list",action:"platforms.list",permission:"L1_READ",idempotencyKey:"k",payload:{}}) as any;
  const byId=Object.fromEntries(view.platforms.map((p:any)=>[p.id,p]));
  assert.equal(byId.fakehost.state,"connected");assert.ok(byId.fakehost.tools.includes("mcp.fakehost.list_sites"));
  assert.match(byId.github.ownerAction,/Integrations -> Platforms \(GITHUB_TOKEN\)/);
  assert.ok(!JSON.stringify(view).includes("fk_123")&&!JSON.stringify(view).includes("vt_ok"),"no token value ever reaches the agent");
  // disconnecting: the server, its tools and its own token go; shared tokens stay
  await disconnectPlatform("fakehost",deps);
  assert.equal(mcp.list().length,0);assert.equal(secrets.has("FAKE_PLATFORM_TOKEN"),false);
  assert.ok(!core.tools.list().some(t=>t.name.startsWith("mcp.fakehost.")));
  secrets.set("GITHUB_TOKEN","ghp_keep");env.GITHUB_TOKEN="ghp_keep";
  await disconnectPlatform("github",deps);
  assert.equal(secrets.get("GITHUB_TOKEN"),"ghp_keep","git push and pull requests still use it");
  await mcp.stop();
}
console.log("platforms: one catalog, Vercel REST tools, connect via the MCP manager and secret store, no second copies");
process.exit(0);
