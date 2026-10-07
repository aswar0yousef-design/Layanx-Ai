import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {safeChildEnv} from "../src/platform/safe-env.js";
import {assertSafeWorkspacePath,isPathInside} from "../src/platform/path-guard.js";
import {assertSafeGitRef} from "../src/platform/git-ref.js";
import {nodeToolCommand,assertSpawnable} from "../src/platform/node-tool.js";
import {capabilityEnabled,parseCapabilities,serializeCapabilities} from "../src/platform/capabilities.js";
import {parseDotEnv} from "../src/platform/dotenv.js";
import {defaultDataDir} from "../src/platform/paths.js";
import {isDevelopmentGoal,selectToolsForGoal,toolBudgetFor,tokenize} from "../src/providers/tool-selection.js";
import {createAgentReachAdapter} from "../src/connectors/agent-reach.js";

// ---------- child env: secrets never forwarded
const source={PATH:"/bin",HOME:"/h",OPENAI_API_KEY:"sk",LAYANX_SECRET_VAULT_KEY:"vault",AGENT_REACH_HOME:"/ar",AGENT_REACH_TOKEN:"t",Path:"C:\\Windows",SystemRoot:"C:\\Windows"};
const posix=safeChildEnv({source,platform:"linux",allowPrefixes:["AGENT_REACH_"],extra:{PYTHONUTF8:"1"}});
assert.deepEqual(Object.keys(posix).sort(),["AGENT_REACH_HOME","HOME","PATH","PYTHONUTF8"]);
const win=safeChildEnv({source,platform:"win32"});
assert.equal(win.Path,"C:\\Windows","Windows names match case-insensitively");
assert.equal(win.SystemRoot,"C:\\Windows");
assert.equal(win.OPENAI_API_KEY,undefined);

// ---------- Windows path traps
const root="C:\\Users\\me\\project";
assert.equal(isPathInside(root,"src\\a.ts","win32"),true);
assert.equal(isPathInside(root,"C:\\USERS\\ME\\PROJECT\\src","win32"),true,"case-insensitive");
assert.equal(isPathInside(root,"D:\\other","win32"),false,"other drive");
assert.equal(isPathInside(root,"..\\secret","win32"),false);
for(const bad of ["src\\a.ts:hidden","CON","src\\nul.txt","secret.env.","notes \\a","\\\\?\\C:\\x","a<b"])
  assert.throws(()=>assertSafeWorkspacePath(root,bad,"win32"),Error,bad);
assert.equal(assertSafeWorkspacePath(root,"src/app.ts","win32"),"C:\\Users\\me\\project\\src\\app.ts");
assert.throws(()=>assertSafeWorkspacePath("/repo","../etc/passwd","linux"));

// ---------- git refs
for(const ok of ["main","origin/main","HEAD~1","feature/agent-reach","v1.2.3","HEAD@{1}"])assert.equal(assertSafeGitRef(ok),ok);
for(const bad of ["--output=C:\\x.txt","-x","main..dev","a b","main;rm","", "x.lock","refs//x"])assert.throws(()=>assertSafeGitRef(bad),Error,bad);

// ---------- node tools: run the JS entry with node, never a .cmd shim
const cmd=nodeToolCommand("tsx",["--version"],process.cwd());
assert.equal(cmd.command,process.execPath);
assert.ok(fs.existsSync(cmd.args[0]!)&&cmd.args[0]!.endsWith(".mjs"));
assert.throws(()=>assertSpawnable("node_modules\\.bin\\tsx.cmd","win32"));

// ---------- capabilities
assert.equal(capabilityEnabled("ads",{LAYANX_CAPABILITIES:"all"}),true);
assert.equal(capabilityEnabled("ads",{LAYANX_CAPABILITIES:"coding,social"}),false);
assert.equal(serializeCapabilities({trading:false}).includes("trading"),false);
assert.equal(parseCapabilities(serializeCapabilities({coding:false,desktop:false,research:false,social:false,ads:false,business:false,email:false,quran:false,voice:false,trading:false})).size,0);

// ---------- data dir is per user, outside the repo
assert.equal(defaultDataDir({LOCALAPPDATA:"C:\\Users\\me\\AppData\\Local"},"win32"),"C:\\Users\\me\\AppData\\Local\\LayanX");
assert.equal(defaultDataDir({LAYANX_DATA_DIR:"/tmp/x"},"win32"),path.resolve("/tmp/x"));

// ---------- intent detection (whole words, Arabic aware)
assert.equal(isDevelopmentGoal("show the latest instagram posts"),false,"latest != test");
assert.equal(isDevelopmentGoal("add a prefix to the campaign name"),false,"prefix != fix");
assert.equal(isDevelopmentGoal("fix the ad copy"),false,"weak term alone is not enough");
assert.equal(isDevelopmentGoal("fix the failing tests"),true);
assert.equal(isDevelopmentGoal("انشر آخر فيديو للمشروع على تيك توك"),false);
assert.equal(isDevelopmentGoal("شغّل اختبارات المستودع"),true);
assert.equal(isDevelopmentGoal("راجع الكود وأصلح الخطأ"),true);
assert.ok(tokenize("والمشروع").includes("مشروع"));

// ---------- tool selection keeps small models focused
const catalog=[
  {name:"social.publish",description:"publish a post",actions:["publish post","نشر منشور"],tags:["social","instagram","tiktok"],permission:"L3_MODIFY"},
  {name:"ads.campaign.create",description:"create ad campaign",actions:["create campaign","إنشاء حملة"],tags:["ads"],permission:"L3_MODIFY"},
  {name:"files.read",description:"read a file",actions:["read file"],tags:["files"],permission:"L1_READ"},
  {name:"terminal.run",description:"run a command",actions:["run command"],tags:["terminal"],permission:"L4_EXECUTE"},
  {name:"quran.publish_next",description:"publish next quran clip",actions:["publish quran"],tags:["quran"],permission:"L4_EXECUTE"},
  {name:"memory.search",description:"search memory",actions:["search memory"],tags:["memory"],permission:"L1_READ"},
  {name:"trading.evaluate",description:"evaluate xauusd",actions:["evaluate trade"],tags:["trading"],permission:"L2_ANALYZE"}
];
const picked=selectToolsForGoal("انشر منشور على انستغرام instagram",catalog,3).map(t=>t.name);
assert.equal(picked[0],"social.publish");
assert.ok(!picked.includes("trading.evaluate"));
assert.equal(toolBudgetFor({paramsB:3,contextLength:131072}),6);
assert.equal(toolBudgetFor({paramsB:7.6,contextLength:4096}),8);
assert.equal(selectToolsForGoal("x",catalog.slice(0,2),5).length,2);

// ---------- .env import parser
const parsed=parseDotEnv("# c\nOPENAI_API_KEY=sk-1\nexport GITHUB_TOKEN=\"ghp x\"\nPORT=3000 # comment\nEMPTY=\n");
assert.deepEqual(parsed.map(p=>[p.key,p.value]),[["OPENAI_API_KEY","sk-1"],["GITHUB_TOKEN","ghp x"],["PORT","3000"],["EMPTY",""]]);

// ---------- Agent Reach fixes
const calls:string[][]=[];
const adapter=createAgentReachAdapter({command:"agent-reach-test",runner:async(_c,args)=>{calls.push(args);return{stdout:JSON.stringify(args[0]==="channels"?["github","web"]:{ok:true}),stderr:"",code:0};}});
const req=(action:string,payload:Record<string,unknown>={})=>({id:"t",missionId:"m",projectId:"p",action,payload,permission:"L1_READ"} as any);
await adapter.execute(req("agent reach setup",{system:"false"}));
assert.ok(calls.at(-1)!.includes("--safe"),'the string "false" must not trigger a system install');
await adapter.execute(req("agent reach setup",{system:true}));
assert.ok(calls.at(-1)!.includes("--system"));
await assert.rejects(adapter.execute(req("agent reach collect",{channel:"github",operation:"search",input:"--system rm"})),/cannot start with/,"user input can never become a flag");
await adapter.execute(req("agent reach collect",{channel:"github",operation:"search",input:"وكلاء الذكاء الاصطناعي"}));
assert.ok(calls.at(-1)!.includes("وكلاء الذكاء الاصطناعي"));

console.log("local-platform: all assertions passed");
