import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// package.json gained a package after package-lock.json was written: `npm ci` refuses, LayanX then runs `npm install`.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-lock-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-lock-store-"));
process.env.LAYANX_DEFAULT_ISOLATION="no-scripts";
const dir=path.join(root,"shop");
fs.mkdirSync(path.join(dir,"local-pkg"),{recursive:true});
fs.writeFileSync(path.join(dir,"local-pkg","package.json"),JSON.stringify({name:"local-pkg",version:"1.0.0"}));
fs.writeFileSync(path.join(dir,"local-pkg","index.js"),"module.exports=1;\n");
fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name:"shop",version:"1.0.0",private:true}));
fs.writeFileSync(path.join(dir,"package-lock.json"),JSON.stringify({name:"shop",version:"1.0.0",lockfileVersion:3,requires:true,packages:{"":{name:"shop",version:"1.0.0"}}}));
// the agent adds a dependency without updating the lock file
fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name:"shop",version:"1.0.0",private:true,dependencies:{"local-pkg":"file:./local-pkg"}}));

const {createProjectRunnerAdapter}=await import("../src/autonomy/project-runner.js");
const run=createProjectRunnerAdapter();
const r=await run.execute({projectId:"shop",tool:"project.run",action:"run project task",payload:{task:"install"}} as never) as Record<string,any>;
assert.equal(r.ok,true,String(r.stderr).slice(-800));
assert.match(r.command,/install/,"fell back to npm install");
assert.match(r.command,/lock file out of date/);
assert.ok(fs.existsSync(path.join(dir,"node_modules","local-pkg")),"the new package is installed");
assert.match(fs.readFileSync(path.join(dir,"package-lock.json"),"utf8"),/local-pkg/,"and the lock file now lists it");

console.log("npm lock sync: npm ci refusing an out-of-date lock file falls back to npm install");
