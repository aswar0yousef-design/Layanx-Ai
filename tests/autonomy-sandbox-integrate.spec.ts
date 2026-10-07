import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {dockerRun,innerCommand,isolationLevel,setIsolation,withoutInstallScripts} from "../src/autonomy/sandbox.js";
import {createProjectRunnerAdapter,detectProject} from "../src/autonomy/project-runner.js";
import {createMergeAdapter,createPublishPrAdapter,githubRepo,pendingBranches} from "../src/autonomy/integrate.js";
process.env.LAYANX_STORE_DIR=(await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(),"lx-store-"));

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-p3-"));process.env.LAYANX_WORKSPACE_ROOT=root;
const isoFile=path.join(root,"isolation.json");process.env.LAYANX_ISOLATION_FILE=isoFile;

// ---------- isolation levels
assert.equal(isolationLevel("web"),"local");
setIsolation(isoFile,"Web","docker");assert.equal(isolationLevel("web"),"docker");
setIsolation(isoFile,"web","no-scripts");assert.equal(isolationLevel("web"),"no-scripts");
assert.throws(()=>setIsolation(isoFile,"web","vm" as any),/Invalid isolation/);

// ---------- docker argv: secrets never passed, no network for tests, limits, separate node_modules
const web=path.join(root,"web");fs.mkdirSync(web);
fs.writeFileSync(path.join(web,"package.json"),JSON.stringify({name:"web",scripts:{test:"node -e 1",dev:"vite",build:"tsc"}}));
const info=detectProject(web);
const test=dockerRun(info,"test",{env:{}});
const a=test.args.join(" ");
assert.match(a,/--network none/,"tests run without network");
for(const f of ["--rm","--cap-drop ALL","--security-opt no-new-privileges","--pids-limit 512","--memory 4g","--cpus 2"])assert.ok(a.includes(f),f);
assert.ok(test.args.includes(`type=bind,source=${web},target=/work`),"only the project folder is mounted");
assert.ok(test.args.some(x=>/^type=volume,source=layanx-nm-[0-9a-f]{12},target=\/work\/node_modules$/.test(x)),"node_modules in its own volume");
assert.deepEqual(test.args.slice(-2),["npm","test"]);
assert.ok(!a.includes("OPENAI")&&!a.includes("TOKEN"),"no secrets in the container environment");
assert.match(dockerRun(info,"install",{env:{}}).args.join(" "),/--network bridge .* npm install --no-audit --no-fund$/,"network only while installing");
const dev=dockerRun(info,"dev:start",{env:{},devPort:43210});
assert.ok(dev.args.includes("127.0.0.1:43210:43210"),"dev port published on localhost only");
assert.deepEqual(dev.args.slice(-8),["npm","run","dev","--","--host","0.0.0.0","--port","43210"],"vite dev server listens on all interfaces inside the container");
assert.equal(dev.args.at(-1),"43210");assert.match(dev.name!,/^layanx-dev-/);
assert.match(dockerRun(info,"test",{env:{LAYANX_DOCKER_MEMORY:"8g; rm",LAYANX_DOCKER_CPUS:"4"}}).args.join(" "),/--memory 4g --cpus 4/,"bad memory value ignored");
const py=path.join(root,"api");fs.mkdirSync(py);fs.writeFileSync(path.join(py,"requirements.txt"),"flask\n");
assert.deepEqual(innerCommand(detectProject(py),"install").args.slice(0,5),["pip","install","--no-cache-dir","--target",".layanx/pydeps"]);
assert.throws(()=>innerCommand(info,"script","x;rm"),/no "x;rm" script/);
assert.deepEqual(withoutInstallScripts(["ci"]),["ci","--ignore-scripts"]);

// ---------- runner: docker selected but not running -> clear error; no-scripts really blocks install scripts
const runner=createProjectRunnerAdapter();
const req=(projectId:string,payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId,tool:"project.run",action:"run project task",permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any);
setIsolation(isoFile,"web","docker");
let dockerHere=false;try{execFileSync("docker",["version"],{stdio:"ignore"});dockerHere=true;}catch{}
if(!dockerHere)await assert.rejects(runner.execute(req("web",{task:"test"})),/Docker is not running/);
const pkg=path.join(root,"scripts-demo");fs.mkdirSync(pkg);
const dep=path.join(root,"evil-dep");fs.mkdirSync(dep);
fs.writeFileSync(path.join(dep,"package.json"),JSON.stringify({name:"evil-dep",version:"1.0.0",scripts:{postinstall:"node -e \"require('fs').writeFileSync(require('path').join(process.env.INIT_CWD||'.','PWNED'),'x')\""}}));
fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({name:"demo",version:"1.0.0",dependencies:{"evil-dep":"file:../evil-dep"}}));
setIsolation(isoFile,"scripts-demo","no-scripts");
const blocked=await runner.execute(req("scripts-demo",{task:"install"})) as any;
assert.equal(blocked.ok,true,blocked.stderr);assert.match(blocked.command,/--ignore-scripts/);
assert.equal(fs.existsSync(path.join(pkg,"PWNED")),false,"the package's postinstall script did not run");
setIsolation(isoFile,"scripts-demo","local");
fs.rmSync(path.join(pkg,"node_modules"),{recursive:true,force:true});
await runner.execute(req("scripts-demo",{task:"install"}));
assert.equal(fs.existsSync(path.join(pkg,"PWNED")),true,"(control) without no-scripts the same script runs");

// ---------- merge a work branch, conflicts abort cleanly, publish as PR
const repo=path.join(root,"shop");fs.mkdirSync(repo);
const g=(...args:string[])=>execFileSync("git",["-c","user.email=a@b.c","-c","user.name=t",...args],{cwd:repo,encoding:"utf8"});
g("init","-q","-b","main");fs.writeFileSync(path.join(repo,"a.txt"),"one\n");g("add",".");g("commit","-qm","init");
g("checkout","-qb","layanx/2026-10-06-add-b");fs.writeFileSync(path.join(repo,"b.txt"),"b\n");g("add",".");g("commit","-qm","LayanX: add b");g("checkout","-q","main");
const pend=await pendingBranches(repo);
assert.deepEqual(pend.map(p=>[p.branch,p.ahead]),[["layanx/2026-10-06-add-b",1]]);
process.env.GIT_AUTHOR_NAME="t";process.env.GIT_AUTHOR_EMAIL="a@b.c";process.env.GIT_COMMITTER_NAME="t";process.env.GIT_COMMITTER_EMAIL="a@b.c";
g("config","user.email","a@b.c");g("config","user.name","t");
const merge=createMergeAdapter();
const mreq=(payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId:"shop",tool:"git.merge",action:"merge branch",permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any);
const merged=await merge.execute(mreq({branch:"layanx/2026-10-06-add-b"})) as any;
assert.equal(merged.merged,true);assert.equal(merged.into,"main");assert.ok(fs.existsSync(path.join(repo,"b.txt")));
assert.match(g("log","-1","--pretty=%s"),/LayanX: merge layanx\/2026-10-06-add-b/);
assert.deepEqual(await pendingBranches(repo),[]);
g("checkout","-qb","layanx/conflict");fs.writeFileSync(path.join(repo,"a.txt"),"branch\n");g("commit","-qam","x");g("checkout","-q","main");fs.writeFileSync(path.join(repo,"a.txt"),"main\n");g("commit","-qam","y");g("checkout","-q","layanx/conflict");
const conflict=await merge.execute(mreq({branch:"layanx/conflict"})) as any;
assert.equal(conflict.conflict,true);assert.equal(g("rev-parse","--abbrev-ref","HEAD").trim(),"layanx/conflict","returned to the original branch");
assert.equal(g("status","--porcelain").trim(),"","nothing left half-merged");
await assert.rejects(merge.execute(mreq({branch:"--upload-pack=evil"})),/./);
assert.deepEqual(githubRepo("git@github.com:me/shop.git"),{owner:"me",repo:"shop"});
assert.deepEqual(githubRepo("https://github.com/me/shop"),{owner:"me",repo:"shop"});
const bare=path.join(root,"bare.git");execFileSync("git",["init","-q","--bare",bare]);
g("remote","add","origin","https://github.com/me/shop.git");g("remote","set-url","--push","origin",bare);
let sent:any=null;process.env.GITHUB_TOKEN="t1";
const pr=createPublishPrAdapter(async(_u,init)=>{sent=JSON.parse(String(init?.body));return new Response(JSON.stringify({number:7,html_url:"https://github.com/me/shop/pull/7"}),{status:201});});
const published=await pr.execute({...mreq({branch:"layanx/conflict",title:"Fix a"}),tool:"git.publish_pr"}) as any;
assert.equal(published.pushed,true);assert.equal(published.pr.url,"https://github.com/me/shop/pull/7");
assert.deepEqual([sent.head,sent.base,sent.title],["layanx/conflict","main","Fix a"]);
assert.match(execFileSync("git",["branch"],{cwd:bare,encoding:"utf8"}),/layanx\/conflict/,"branch was pushed");
delete process.env.GITHUB_TOKEN;
console.log("autonomy-sandbox-integrate: isolation levels, docker sandbox, no install scripts, merge, conflicts and pull requests verified");
process.exit(0);
