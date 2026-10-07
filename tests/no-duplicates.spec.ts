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
for(const required of ["desktop.ui.tree","project.code_map","project.references","mcp.registry.search","mcp.server.request","memory.recall"])assert.ok(names.has(required),required+" is registered");

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
  "LAYANX_TTS_BASE_URL","LAYANX_TTS_VOICE_AR","LAYANX_AGENT_IMAGE_AIDER","LAYANX_TOOLS_DIR","LAYANX_EXTERNAL_SCANNERS","LAYANX_OPENGREP_CONFIG","LAYANX_MCP_REGISTRY_URL","LAYANX_DESKTOP_PREWARM","LAYANX_SKILLS_DIR"])
  assert.ok(guide.includes(name),name+" is documented in docs/دليل-التشغيل.md");
console.log(`no-duplicates: ${tools.length} tools, ${routes.size} routes, agent grants and settings docs consistent`);
process.exit(0);
