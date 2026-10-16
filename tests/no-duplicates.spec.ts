import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Guards against the "added twice / added in conflict" class of bugs: tools, actions, grants, routes, docs.
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-dup-"));
process.env.LAYANX_CAPABILITIES="all";
process.env.LAYANX_DESKTOP_PREWARM="off";
const {createRuntime}=await import("../src/runtime.js");
const runtime=createRuntime({storagePath:path.join(process.env.LAYANX_STORE_DIR,"runtime.json")}) as any;
const core=runtime.core??runtime;

// 1. Tools: every action belongs to exactly one tool (the planner must not have to guess), every tool has an adapter.
const tools=core.tools.list() as Array<{name:string;actions?:string[]}>;
const owners=new Map<string,string[]>();
for(const t of tools)for(const a of t.actions??[])owners.set(a,[...(owners.get(a)??[]),t.name]);
assert.deepEqual([...owners].filter(([,v])=>v.length>1),[],"an action string is shared by several tools");
assert.deepEqual(tools.filter(t=>!core.toolAdapters.has(t.name)).map(t=>t.name),[],"tool without an adapter");
// 2. Every tool an agent is allowed to use exists.
const names=new Set(tools.map(t=>t.name));
for(const agent of core.agents.list() as Array<{agentId:string;allowedTools:string[]}>)
  assert.deepEqual(agent.allowedTools.filter(t=>t!=="*"&&!t.endsWith(".")&&!names.has(t)),[],`agent ${agent.agentId} lists missing tools`);
for(const required of ["desktop.ui.tree","project.code_map","project.references","apis.search","mcp.registry.search","mcp.server.request","memory.recall","trading.mt5.positions","trading.mt5.history","trading.mt5.tester.run"])assert.ok(names.has(required),required+" is registered");

// 3. HTTP routes: no method+path is handled twice, inside a file or between the API server and the local host.
const routes=new Map<string,string[]>();
const scan=(file:string,patterns:RegExp[])=>{const text=fs.readFileSync(new URL(file,import.meta.url),"utf8");
  for(const rx of patterns)for(const m of text.matchAll(rx)){const key=(m.groups!.method+" "+m.groups!.path);routes.set(key,[...(routes.get(key)??[]),file]);}};
scan("../src/api-server.ts",[/request\.method==="(?<method>[A-Z]+)"&&request\.url(?:\?\.split\("\?"\)\[0\])?==="(?<path>\/[^"]+)"/g]);
scan("../src/local/setup-routes.ts",[/path==="(?<path>\/[^"]+)"&&method==="(?<method>[A-Z]+)"/g]);
assert.ok(routes.size>30,"routes were found ("+routes.size+")");
assert.deepEqual([...routes].filter(([,files])=>files.length>1),[],"route handled twice");

// 4. New settings are documented for the owner.
const guide=fs.readFileSync(new URL("../docs/دليل-التشغيل.md",import.meta.url),"utf8");
for(const name of ["LAYANX_OLLAMA_STRUCTURED","LAYANX_STORAGE","LAYANX_SEMANTIC_MEMORY","LAYANX_EMBEDDING_MODEL","LAYANX_CLOUD_MONTHLY_BUDGET_USD","LAYANX_CLOUD_MONTHLY_TOKENS","LAYANX_PROMPT_BUDGET_CHARS",
  "LAYANX_TTS_BASE_URL","LAYANX_TTS_VOICE_AR","LAYANX_AGENT_IMAGE_AIDER","LAYANX_TOOLS_DIR","LAYANX_EXTERNAL_SCANNERS","LAYANX_OPENGREP_CONFIG","LAYANX_MCP_REGISTRY_URL","LAYANX_DESKTOP_PREWARM","LAYANX_SKILLS_DIR",
  "LAYANX_ZAP","LAYANX_ZAP_IMAGE","LAYANX_VOICE_SENSE_URL","LAYANX_VOICE_SENSE_PORT","LAYANX_STT_ENGINE","LAYANX_COHERE_PORT","LAYANX_COHERE_DEVICE","LAYANX_URL","LAYANX_API_TOKEN","LAYANX_DOCKER_MEMORY","LAYANX_OLLAMA_NUM_PREDICT","LAYANX_STT_FALLBACK_URL","LAYANX_OPEN_BROWSER","LAYANX_API_CATALOG",
  "MT5_ALLOW_REAL_ACCOUNT","MT5_MAX_CONSECUTIVE_LOSSES","MT5_TESTER_TERMINAL","MT5_TESTER_TIMEOUT_MINUTES","LAYANX_DESKTOP_ISLAND","LAYANX_HUMANIZER"])
  assert.ok(guide.includes(name),name+" is documented in docs/دليل-التشغيل.md");
// 5. Every LAYANX_* setting the new code reads appears in .env.example too.
const example=fs.readFileSync(new URL("../.env.example",import.meta.url),"utf8");
for(const name of ["LAYANX_ZAP","LAYANX_ZAP_IMAGE","LAYANX_VOICE_SENSE_URL","LAYANX_VOICE_SENSE_PORT","LAYANX_STT_ENGINE","LAYANX_COHERE_PORT","LAYANX_COHERE_DEVICE","LAYANX_URL","LAYANX_EVAL_DIR","LAYANX_OLLAMA_NUM_PREDICT","LAYANX_STT_FALLBACK_URL","LAYANX_OPEN_BROWSER","LAYANX_API_CATALOG",
  "MT5_ALLOW_REAL_ACCOUNT","MT5_MAX_CONSECUTIVE_LOSSES","MT5_TESTER_TERMINAL","MT5_TESTER_TIMEOUT_MINUTES","LAYANX_DESKTOP_ISLAND","LAYANX_HUMANIZER"])
  assert.ok(new RegExp("^"+name+"=","m").test(example),name+" is in .env.example");
// 6. One Python finder for all Windows installers (no copies drifting apart).
for(const f of ["install-piper.ps1","install-voice-sense.ps1","install-cohere-asr.ps1"]){
  const text=fs.readFileSync(new URL("../scripts/windows/"+f,import.meta.url),"utf8");
  assert.ok(!/function Find-Python/.test(text),f+" uses scripts/windows/python.ps1 instead of its own Find-Python");
}
// 7. One way to decide an approval and carry on: decideApproval() on the PC. The phone, the island and the
//    Claude Code / Codex hook never resume missions themselves, and only the phone's native screen decides there.
const read=(f:string)=>fs.readFileSync(new URL(f,import.meta.url),"utf8");
assert.ok(!/agent-loop/.test(read("../mobile/src/api.ts")),"the phone does not resume missions itself (the PC continues after a decision)");
assert.ok(!/\/approve|\/revoke/.test(read("../scripts/windows/island.ps1")),"the island shows approvals, it does not decide");
assert.ok(!/\/approve|\/revoke/.test(read("../scripts/agent-hook.mjs")),"the hook asks, it does not decide");
assert.equal((read("../src/api-server.ts").match(/approvals\.(approve|revoke)\(/g)??[]).length,0,"the API server decides only through decideApproval");
assert.equal((read("../src/remote/companion.ts").match(/approvals\.approve\(/g)??[]).length,2,"decideApproval: mission and external requests");
// 8. One QR encoder, one certificate maker.
for(const f of ["../src/local/setup-routes.ts","../src/local/setup-page.ts"])assert.ok(!/function qr|qrcode/i.test(read(f).replace(/qrSvg|pair-qr|qr-note|\.qr\{|"qr"/g,"")),f+" uses src/platform/qr.ts");
// 9. One humanizer: every path that writes for people uses src/business/humanizer.ts, not its own cleaner or word list.
for(const f of ["../src/business/manager.ts","../src/business/ads.ts","../src/creator/engine.ts","../src/business/humanizer-tool.ts","../src/api-server.ts"])
  assert.match(read(f),/from "\.{1,2}\/(business\/)?humanizer\.js"/,f+" uses the shared humanizer");
const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith(".ts")?[path.join(dir,e.name)]:[]);
const listed=walk(fileURLToPath(new URL("../src",import.meta.url))).filter(f=>/في عالم اليوم|it's worth noting/i.test(fs.readFileSync(f,"utf8")));
assert.deepEqual(listed.map(f=>path.basename(f)),["humanizer-patterns.ts"],"stock-phrase lists live in one file");
assert.equal(tools.filter(t=>t.name==="content.humanize").length,1);
// 10. Website platforms: one catalog, one way to connect each, one token per platform, shown once.
{
  const {PLATFORMS}=await import("../src/platforms/catalog.js");
  const {platformFor}=await import("../src/platforms/connect.js");
  for(const p of PLATFORMS.filter(x=>x.mcp))assert.equal(platformFor(p.mcp!)?.id,p.id,p.id+" is recognised as itself only");
  const secretOwners=new Map<string,string[]>();
  for(const p of PLATFORMS)for(const s of p.secrets)secretOwners.set(s.name,[...(secretOwners.get(s.name)??[]),p.id]);
  for(const [name,owners] of secretOwners)assert.equal(owners.length,1,name+" belongs to one platform ("+owners.join(", ")+")");
  // Vercel has native tools only, Claude is managed on the setup page: no MCP copy of either.
  assert.equal(PLATFORMS.find(p=>p.id==="vercel")!.mcp,undefined);assert.equal(PLATFORMS.find(p=>p.id==="claude")!.mcp,undefined);
  // The GitHub server adds Actions only; LayanX's own github.* tools cover repositories, issues and pull requests.
  assert.match(PLATFORMS.find(p=>p.id==="github")!.mcp!.url!,/\/mcp\/x\/actions$/);
  // Connecting goes through the one MCP manager and secret store (no second server list, no second vault).
  const connect=read("../src/platforms/connect.ts");
  assert.ok(!/writeFileSync|LocalSecretVault|new McpManager/.test(connect),"connect.ts reuses the MCP manager and the secret store");
  // GitHub and Claude are shown once in the Control Center: under Platforms, not again in the status grid.
  const ui=read("../web/app.js");
  assert.ok(!/\["GitHub",has\("GITHUB_TOKEN"\)/.test(ui));
  assert.match(ui,/filter\(p=>p\.keyName!=="ANTHROPIC_API_KEY"\)/);
  assert.equal(tools.filter(t=>t.name==="platforms.list").length,1);
}
console.log(`no-duplicates: ${tools.length} tools, ${routes.size} routes, agent grants and settings docs consistent`);
process.exit(0);
