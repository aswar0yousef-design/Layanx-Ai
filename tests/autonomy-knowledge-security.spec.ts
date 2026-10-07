import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {knowledgeSummary,openIssues,recordDecision,recordIssue,refreshKnowledge,resolveIssue,readHealth,updateHealth} from "../src/autonomy/knowledge.js";
import {securityReport,scanCode} from "../src/autonomy/security-scan.js";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";
process.env.LAYANX_STORE_DIR=(await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(),"lx-store-"));

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-p2-"));process.env.LAYANX_WORKSPACE_ROOT=root;
const dir=path.join(root,"shop");
const w=(rel:string,text:string)=>{fs.mkdirSync(path.dirname(path.join(dir,rel)),{recursive:true});fs.writeFileSync(path.join(dir,rel),text);};
w("package.json",JSON.stringify({name:"shop",scripts:{test:"node t.js",dev:"node server.js"},dependencies:{express:"^4"}}));
w("src/index.ts","export const app=1;\n");w("src/api/products.ts","export function list(){return []}\n");w("src/admin/products.ts","export const x=1;\n");
w("tests/products.test.ts","const key='"+["sk","test","not","real","1234567890abcdef"].join("-")+"';\n");
w("node_modules/big/index.js","eval('x')\n");

// ---------- project memory
const ix=refreshKnowledge(dir);
assert.equal(ix.stack,"node");assert.ok(ix.entryPoints.includes("src/index.ts"));
assert.equal(ix.tests.files,1);assert.ok(ix.duplicates.some(d=>d.name==="products.ts"),"same file name in two folders is flagged");
assert.ok(!JSON.stringify(ix).includes("node_modules"),"dependencies folder is not indexed");
const arch=fs.readFileSync(path.join(dir,".layanx","ARCHITECTURE.md"),"utf8");assert.match(arch,/layanx:auto:start/);
fs.writeFileSync(path.join(dir,".layanx","ARCHITECTURE.md"),"# Architecture\n\nOwner note: payments live in src/pay.\n\n"+arch.slice(arch.indexOf("<!-- layanx:auto:start")));
refreshKnowledge(dir);assert.match(fs.readFileSync(path.join(dir,".layanx","ARCHITECTURE.md"),"utf8"),/Owner note: payments live in src\/pay/,"owner notes survive a refresh");
recordDecision(dir,"Use SQLite for the cart","Single user, no server needed");
recordIssue(dir,"Checkout fails on Safari","TypeError in cart.js");recordIssue(dir,"Checkout fails on Safari","dup");
assert.deepEqual(openIssues(dir).length,1,"issues are not duplicated");
updateHealth(dir,"test",{ok:false,summary:"2 failing"});
fs.writeFileSync(path.join(dir,".layanx","CHANGELOG.md"),"## 2026-10-06 10:00 — Added the cart\n- [x] Cart\n");
const summary=knowledgeSummary("shop");
for(const part of ["Added the cart","MAP: node","Use SQLite for the cart","Checkout fails on Safari","test:FAIL"])assert.ok(summary.includes(part),"summary contains "+part);
assert.equal(resolveIssue(dir,"Checkout fails on Safari"),true);assert.equal(openIssues(dir).length,0);
assert.equal(readHealth(dir).test?.ok,false);

// ---------- security scan of a deliberately vulnerable project
w("src/db.ts","export const q=(id:string)=>db.query(`SELECT * FROM users WHERE id=${id}`);\n");
w("src/run.ts","import {exec} from 'child_process';export const go=(f:string)=>exec(`convert ${f}`);\n");
w("src/view.ts","el.innerHTML = userInput;\n");
w("src/http.ts","const agent=new https.Agent({rejectUnauthorized:false});\n");
w("src/auth.ts","jwt.sign(payload,'"+"super-"+"secret-value');\nconst pass"+"word = \""+"hunter2"+"hunter2\";\n");
w("src/ok.ts","el.innerHTML = '';\nconst safe = db.query('SELECT * FROM t WHERE id=$1',[id]); // fine\nconst t=Math.random()*10;\n");
w("src/reviewed.ts","eval(trusted); // layanx-ignore-security\n");
w(".env","DB_PASSWORD=real\n");
const code=scanCode(dir);
const rules=new Set(code.findings.map(f=>f.rule));
for(const r of ["code.sql-injection","code.command-injection","web.xss-sink","tls.disabled","auth.jwt-literal","secret.literal","secret.env-not-ignored","web.no-helmet"])assert.ok(rules.has(r),"detects "+r);
assert.ok(!code.findings.some(f=>f.file==="src/ok.ts"),"safe code is not flagged");
assert.ok(!code.findings.some(f=>f.file==="src/reviewed.ts"),"reviewed lines can be silenced");
assert.ok(!code.findings.some(f=>f.file?.startsWith("node_modules")),"dependencies are not scanned as project code");
assert.equal(code.findings.find(f=>f.file==="tests/products.test.ts")?.test,true,"test fixtures are marked as tests");
const report=await securityReport(dir,{audit:false});
assert.equal(report.blocked,true);assert.ok(report.score<50);assert.equal(readHealth(dir).security?.ok,false);
assert.ok(fs.existsSync(path.join(dir,".layanx","security.json")));
// fix everything -> clean
assert.ok(report.findings.some(f=>f.rule==="secret.cloud-key"&&f.test),"a real-looking key blocks even inside a test file");
for(const f of ["src/db.ts","src/run.ts","src/view.ts","src/http.ts","src/auth.ts","tests/products.test.ts"])fs.rmSync(path.join(dir,f));
fs.writeFileSync(path.join(dir,".gitignore"),".env*\nnode_modules\n");
const clean=await securityReport(dir,{audit:false});
assert.equal(clean.blocked,false,JSON.stringify(clean.findings));

// ---------- supervisor: works on a branch, blocks delivery on security findings, then passes
let secRuns=0;const tools:string[]=[];const goals:string[]=[];
const deps:SupervisorDeps={
  think:async()=>JSON.stringify({acceptance:["api works"],milestones:[{title:"API",goal:"add api",kind:"code"}],checks:{test:true}}),
  runAgent:async(goal)=>{goals.push(goal);return{completed:true,missionId:"m"};},resumeAgent:async()=>({completed:true}),
  async runTool(_p,tool,payload){tools.push(tool+(payload.branch?":"+payload.branch:""));
    if(tool==="git.status")return{ok:true,data:{stdout:"## main...origin/main\n M src/a.ts\n"}};
    if(tool==="project.security"){secRuns++;return secRuns===1?{ok:false,data:{score:40,blocked:true,counts:{critical:0,high:1},findings:[{severity:"high",message:"SQL built by string concatenation",file:"src/db.ts",line:3,fix:"Use parameterised queries"}]}}:{ok:true,data:{score:96,blocked:false,counts:{critical:0,high:0}}};}
    return{ok:true,data:{ok:true,exitCode:0}};},
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null,
  detect:()=>({dir,stack:"node",scripts:["test"],hasLockfile:true,git:true,tasks:[]} as any)
};
const sup=new Supervisor(deps,{pollMs:5});
const job=sup.create("add the products API","shop");
const end=Date.now()+8000;while(!["completed","failed"].includes(sup.get(job.id)!.status)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
const j=sup.get(job.id)!;
assert.equal(j.status,"completed",j.log.map(l=>l.msg).join("\n"));
assert.match(j.branch??"",/^layanx\/\d{4}-\d\d-\d\d-add-the-products-api-/,"works on its own branch, not main");
assert.ok(tools.some(t=>t.startsWith("git.branch:layanx/")));
assert.equal(secRuns,2,"security scanned, fixed, scanned again");
assert.equal(j.milestones.at(-1)!.title,"Fix final verification");
assert.ok(goals.some(g=>/SQL built by string concatenation \(src\/db.ts:3\) — Use parameterised queries/.test(g)),"the security finding and its fix were handed to the coder");
assert.ok(goals[0]!.includes("Project memory"),"the agent receives the project memory");
assert.equal(j.security?.score,96);assert.match(j.result!,/security score 96\/100/);
console.log("autonomy-knowledge-security: project memory, security scan and delivery gate verified");
process.exit(0);
