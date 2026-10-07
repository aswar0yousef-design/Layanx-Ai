import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {commandFor,createProjectRunnerAdapter,detectProject,stopAllDevServers} from "../src/autonomy/project-runner.js";
import {setTrust,trustAllows,trustLevel} from "../src/autonomy/trust.js";
import {autoApproved} from "../src/core/runtime.js";
import {externalCommand} from "../src/autonomy/external-agents.js";

// ---------- trust levels
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-auto-"));
const trustFile=path.join(dir,"trust.json");
const env={LAYANX_TRUST_FILE:trustFile} as NodeJS.ProcessEnv;
assert.equal(trustLevel("shop",env),"supervised");
assert.equal(trustAllows("files.write","shop",env),false,"supervised asks for everything");
setTrust(trustFile,"Shop","trusted");
assert.equal(trustLevel("shop",env),"trusted");
for(const t of ["files.write","project.run","git.commit","browser.test"])assert.equal(trustAllows(t,"shop",env),true,t+" runs alone when trusted");
for(const t of ["git.push","google.gmail.send","content.publish","ads.campaign.launch","trading.order.place","desktop.mouse.click","agent-reach.setup"])assert.equal(trustAllows(t,"shop",env),false,t+" still needs the owner");
assert.equal(trustAllows("agent.external","shop",env,"local"),true,"local coding agent ok when trusted");
assert.equal(trustAllows("agent.external","shop",env),false,"cloud coding agent needs full trust");
setTrust(trustFile,"shop","full");
assert.equal(trustAllows("desktop.mouse.click","shop",env),true);
for(const t of ["git.push","google.gmail.send","content.publish","trading.order.place"])assert.equal(trustAllows(t,"shop",env),false,t+" never automatic");
assert.equal(autoApproved("agent.external",env,"shop",{agent:"claude-code"}),true);
assert.equal(autoApproved("git.push",env,"shop",{}),false);
assert.equal(autoApproved("files.write",env,"other",{}),false,"other projects keep their own level");

// ---------- stack detection and fixed command templates
const node=path.join(dir,"web");fs.mkdirSync(node);
fs.writeFileSync(path.join(node,"package.json"),JSON.stringify({name:"web",scripts:{test:"node -e \"console.log('7 passing')\"",build:"node -e \"require('fs').writeFileSync('built.txt','ok')\"",dev:"node server.js","evil;rm":"x"}}));
fs.writeFileSync(path.join(node,"server.js"),"require('http').createServer((q,r)=>r.end('<h1>hi</h1>')).listen(0,'127.0.0.1',function(){console.log('ready on http://localhost:'+this.address().port)})");
const info=detectProject(node);
assert.equal(info.stack,"node");assert.deepEqual(info.tasks.sort(),["build","dev:start","install","test"].sort());
assert.throws(()=>commandFor(info,"script","evil;rm"),/Invalid script name/,"script names cannot carry shell syntax");
assert.throws(()=>commandFor(info,"lint"),/no "lint" script/);
assert.deepEqual(commandFor({...info,hasLockfile:true},"install").args.slice(-3),["ci","--no-audit","--no-fund"]);
const py=path.join(dir,"api");fs.mkdirSync(py);fs.writeFileSync(path.join(py,"requirements.txt"),"flask\n");
assert.equal(detectProject(py).stack,"python");assert.match(commandFor(detectProject(py),"test").label,/pytest/);
assert.throws(()=>commandFor(detectProject(path.join(dir,"empty-x")),"test"),/No supported project/);

// ---------- real runs through the adapter (npm without cmd.exe, no secrets in the child)
process.env.LAYANX_WORKSPACE_ROOT=dir;
process.env.SUPER_SECRET_API_KEY="leak1";
fs.writeFileSync(path.join(node,"package.json"),JSON.stringify({name:"web",scripts:{test:"node -e \"console.log('7 passing',process.env.SUPER_SECRET_API_KEY??'clean')\"",build:"node -e \"require('fs').writeFileSync('built.txt','ok')\"",dev:"node server.js"}}));
const runner=createProjectRunnerAdapter();
const req=(payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId:"web",tool:"project.run",action:"run project task",permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any);
const test=await runner.execute(req({task:"test"})) as any;
assert.equal(test.ok,true,test.stderr);assert.match(test.stdout,/7 passing clean/,"secret was not passed to the project script");
const build=await runner.execute(req({task:"build"})) as any;
assert.equal(build.ok,true);assert.equal(fs.readFileSync(path.join(node,"built.txt"),"utf8"),"ok");
const dev=await runner.execute(req({task:"dev:start"})) as any;
assert.equal(dev.running,true);assert.match(dev.url,/^http:\/\/localhost:\d+/);
assert.match(await (await fetch(dev.url)).text(),/<h1>hi<\/h1>/);
assert.equal((await runner.execute(req({task:"dev:stop"})) as any).stopped,true);
stopAllDevServers();

// ---------- external coding agents: one argv entry, never a shell
const aider=externalCommand({name:"aider",kind:"local",path:"/usr/bin/aider",label:""},"--rm -rf / ; fix the login bug",{OLLAMA_BASE_URL:"http://127.0.0.1:11434/"});
assert.equal(aider.args.at(-1),"Task: --rm -rf / ; fix the login bug","task cannot become a flag");
assert.ok(aider.args.includes("--no-auto-commits"));assert.equal(aider.extraEnv.OLLAMA_API_BASE,"http://127.0.0.1:11434");
const claude=externalCommand({name:"claude-code",kind:"cloud",path:"/x/cli.js",label:""},"add tests",{ANTHROPIC_API_KEY:"k1"});
assert.equal(claude.command,process.execPath);assert.deepEqual(claude.args.slice(1,3),["-p","Task: add tests"]);assert.ok(claude.args.includes("acceptEdits"));
const codex=externalCommand({name:"codex",kind:"cloud",path:"/x/codex.js",label:""},"refactor",{LAYANX_CODEX_ARGS:"--full-auto ; rm"});
assert.deepEqual(codex.args.slice(1),["exec","--full-auto","Task: refactor"],"only flag-shaped extra args are kept");

console.log("autonomy-runner: trust levels, project runner, dev server and coding agents verified");
process.exit(0);
