import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createProjectBootstrapToolAdapter,createProjectVerifyToolAdapter,createTerminalToolAdapter} from "../src/tools/fabric.js";
import {setIsolation} from "../src/autonomy/sandbox.js";
import {gitRunsPrograms,gitSafetyArgs,fileIdentity,projectSandboxDir,refuseSharedPnpmStore,verifyGitAfterRun} from "../src/platform/windows-sandbox.js";
import {createExternalAgentAdapter,externalDockerCommand} from "../src/autonomy/external-agents.js";

// Every tool that runs a project's npm scripts honours the project's isolation (not only project.run).
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-iso-tools-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
process.env.LAYANX_STORE_DIR=path.join(root,".store");
const iso=path.join(root,"isolation.json");process.env.LAYANX_ISOLATION_FILE=iso;
const shop=path.join(root,"shop");fs.mkdirSync(shop);
fs.writeFileSync(path.join(shop,"package.json"),JSON.stringify({name:"shop",version:"1.0.0",scripts:{test:"node -e \"console.log('tested')\"",build:"node -e 1",typecheck:"node -e 1"}}));
const req=(tool:string,action:string,payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId:"shop",tool,action,permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any);

setIsolation(iso,"shop","no-scripts");
const verify=await createProjectVerifyToolAdapter({root}).execute(req("project.verify","verify project",{script:"test"})) as any;
assert.equal(verify.isolation,"no-scripts","project.verify went through project.run");
assert.equal(verify.passed,true,verify.stderr);assert.match(verify.stdout,/tested/);
const term=await createTerminalToolAdapter({root}).execute(req("terminal.exec","run terminal command",{command:"npm test"})) as any;
assert.equal(term.isolation,"no-scripts","terminal.exec npm test went through project.run");assert.equal(term.exitCode,0);
setIsolation(iso,"shop","docker");
await assert.rejects(createProjectBootstrapToolAdapter({root}).execute(req("project.bootstrap","bootstrap project",{dependencies:["left-pad"]})) as Promise<unknown>,/isolated in Docker/);
if(process.platform!=="win32"){
  setIsolation(iso,"shop","restricted");
  await assert.rejects(createProjectVerifyToolAdapter({root}).execute(req("project.verify","verify project",{script:"test"})) as Promise<unknown>,/Windows only/,"never falls back to running unprotected");
  await assert.rejects(createProjectBootstrapToolAdapter({root}).execute(req("project.bootstrap","bootstrap project",{dependencies:["left-pad"]})) as Promise<unknown>,/Windows only/);
}
setIsolation(iso,"shop","local");
const local=await createProjectVerifyToolAdapter({root}).execute(req("project.verify","verify project",{script:"test"})) as any;
assert.equal(local.isolation,undefined,"local projects keep the direct path");assert.equal(local.passed,true);

// .git replaced by a command: the impostor is moved aside and the original put back (found by identity).
const proj=path.join(root,"gitproj");fs.mkdirSync(path.join(proj,".git","hooks"),{recursive:true});fs.writeFileSync(path.join(proj,".git","HEAD"),"ref: refs/heads/main\n");
const before={id:fileIdentity(path.join(proj,".git"))};
assert.equal(await verifyGitAfterRun(proj,before),undefined,"unchanged .git: no warning");
fs.renameSync(path.join(proj,".git"),path.join(proj,"old-git"));
fs.mkdirSync(path.join(proj,".git","hooks"),{recursive:true});fs.writeFileSync(path.join(proj,".git","hooks","pre-commit"),"evil");
const warning=await verifyGitAfterRun(proj,before);
assert.match(warning!,/moved the \.git folder the command made to \.git-untrusted-\d+.*put the original \.git back \(it had been renamed to old-git\)/);
assert.equal(fs.readFileSync(path.join(proj,".git","HEAD"),"utf8"),"ref: refs/heads/main\n");
assert.ok(!fs.existsSync(path.join(proj,".git","hooks","pre-commit")),"the planted hook is not in the real .git");
const fresh=path.join(root,"fresh");fs.mkdirSync(fresh);
const none={id:fileIdentity(path.join(fresh,".git"))};
fs.mkdirSync(path.join(fresh,".git"));
assert.match((await verifyGitAfterRun(fresh,none))!,/moved the \.git folder the command made/);
assert.ok(!fs.existsSync(path.join(fresh,".git")),"a .git created by the command is not used by LayanX");

// LayanX's own git commands in sandbox-writable folders run without hooks.
fs.mkdirSync(path.join(process.env.LAYANX_STORE_DIR,"sandbox"),{recursive:true});
fs.writeFileSync(path.join(process.env.LAYANX_STORE_DIR,"sandbox","prepared.json"),JSON.stringify({folders:{[path.resolve(shop).toLowerCase()]:{level:"L",id:"1"},[path.resolve(proj,".git").toLowerCase()]:{level:"M",id:"2"}},protected:{}}));
await new Promise(r=>setTimeout(r,2100));
const args=gitSafetyArgs(path.join(shop,"src"));
assert.deepEqual(args.filter(a=>a!=="-c").map(a=>a.split("=")[0]),["core.hooksPath","core.fsmonitor"]);
assert.deepEqual(gitSafetyArgs(path.join(root,"other")),[],"other folders keep their hooks");
assert.deepEqual(gitSafetyArgs(shop+"-copy"),[],"prefix of another folder name is not a match");
// ...and refuse to run at all when the .git is not the one LayanX checked.
const shopGit=path.join(shop,".git");fs.mkdirSync(shopGit);fs.writeFileSync(path.join(shopGit,"config"),"[core]\n\tbare = false\n[remote \"origin\"]\n\turl = https://example.com/x.git\n");
assert.equal(gitRunsPrograms(shopGit),false,"plain config");
fs.appendFileSync(path.join(shopGit,"config"),"[core]\n\thooksPath = .husky\n\tfsmonitor = true\n");
assert.equal(gitRunsPrograms(shopGit),false,"husky's hooksPath and fsmonitor are overridden by LayanX, not refused");
assert.equal(gitSafetyArgs(path.join(shop,"src")).length,4,"new .git without program settings: hooks off, allowed");
fs.appendFileSync(path.join(shopGit,"config"),"[filter \"x\"]\n\tclean = evil.exe\n");
assert.equal(gitRunsPrograms(shopGit),true);
assert.throws(()=>gitSafetyArgs(path.join(shop,"src")),/not checked by LayanX/,"new .git with a filter: refused");
for(const cfg of ["[remote \"o\"]\n\turl = ext::sh -c evil\n","[url \"ext::sh -c evil \"]\n\tinsteadOf = https://\n","[protocol \"ext\"]\n\tallow = always\n","[include]\n\tpath = ../evil\n","[core]\n\tsshCommand = evil\n","[diff \"x\"]\n  textconv = evil\n","[credential]\nhelper=evil\n"]){
  fs.writeFileSync(path.join(shopGit,"config"),cfg);assert.equal(gitRunsPrograms(shopGit),true,cfg);
}
const marker=path.join(process.env.LAYANX_STORE_DIR,"sandbox","prepared.json");
const m=JSON.parse(fs.readFileSync(marker,"utf8"));m.folders[path.resolve(shopGit).toLowerCase()]={level:"M",id:"0:0"};fs.writeFileSync(marker,JSON.stringify(m));
await new Promise(r=>setTimeout(r,2100));
assert.throws(()=>gitSafetyArgs(shop),/was replaced while a sandboxed command was running/,"swapped .git: refused");
m.folders[path.resolve(shopGit).toLowerCase()]={level:"M",id:fileIdentity(shopGit)};fs.writeFileSync(marker,JSON.stringify(m));
await new Promise(r=>setTimeout(r,2100));
assert.equal(gitSafetyArgs(shop).length,4,"the checked .git: allowed (its config cannot be changed from the sandbox)");
fs.rmSync(shopGit,{recursive:true,force:true});

// Each project has its own sandbox temp/cache/home.
assert.notEqual(projectSandboxDir(path.join(root,"a","app")),projectSandboxDir(path.join(root,"b","app")),"same folder name, different projects");
assert.equal(projectSandboxDir(shop),projectSandboxDir(shop+path.sep),"stable");
// pnpm links from a shared store are refused before labelling (the label would reach the shared store).
const pn=path.join(root,"pnpm-proj");fs.mkdirSync(path.join(pn,"node_modules"),{recursive:true});
fs.writeFileSync(path.join(pn,"node_modules",".modules.yaml"),"layoutVersion: 5\nstoreDir: C:\\Users\\me\\AppData\\Local\\pnpm\\store\\v10\n");
assert.throws(()=>refuseSharedPnpmStore(pn,path.join(root,"own-cache")),/shared store/);
fs.writeFileSync(path.join(pn,"node_modules",".modules.yaml"),`storeDir: ${path.join(root,"own-cache","pnpm-store")}\n`);
assert.doesNotThrow(()=>refuseSharedPnpmStore(pn,path.join(root,"own-cache")),"the project's own store is fine");

// A project name never silently moves to another folder (its trust and isolation would follow it).
{
  const {linkProject,ProjectIdTakenError}=await import("../src/platform/linked-projects.js");
  const file=path.join(root,"projects.json");const f1=path.join(root,"f1"),f2=path.join(root,"f2");fs.mkdirSync(f1);fs.mkdirSync(f2);
  linkProject(file,"app",f1);
  assert.doesNotThrow(()=>linkProject(file,"app",f1),"linking the same folder again is fine");
  assert.throws(()=>linkProject(file,"app",f2),(e:unknown)=>e instanceof ProjectIdTakenError&&/already linked/.test((e as Error).message));
  assert.equal(linkProject(file,"app",f2,{replace:true}).path,path.resolve(f2),"the owner can move it on purpose");
}

// Docker coding agents: API keys by name only (never on the command line).
const fakeKey=["sk","ant","not-a-real-key"].join("-");
const docker=externalDockerCommand({name:"claude-code",kind:"cloud",path:"x",label:"Claude Code"},"fix it",shop,{LAYANX_AGENT_IMAGE_CLAUDE_CODE:"anthropic/claude-code:1.2.3",ANTHROPIC_API_KEY:fakeKey});
assert.ok(!docker.args.some(a=>a.includes(fakeKey)),"key value not in docker argv");
assert.ok(docker.args.includes("ANTHROPIC_API_KEY"));assert.equal(docker.passEnv.ANTHROPIC_API_KEY,fakeKey);
void createExternalAgentAdapter;
fs.rmSync(root,{recursive:true,force:true});
console.log("isolation-tools: verify/terminal/bootstrap honour isolation, .git swaps are undone, hooks off in sandboxed folders, docker keys by name");
process.exit(0);
