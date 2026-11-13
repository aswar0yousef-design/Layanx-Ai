import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-kit-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-kit-store-"));
const {copyKit}=await import("../src/autonomy/templates.js");
const {createProjectRunnerAdapter,detectProject}=await import("../src/autonomy/project-runner.js");
const {matchPlaybooks}=await import("../src/autonomy/learning.js");
const {DASHBOARD_GOAL,ANDROID_GOAL}=await import("../src/autonomy/supervisor.js");
const {newProjectKind}=await import("../src/voice/project-intent.js");

// ---------- the kit is copied whole, never over the owner's files ----------
const dir=path.join(root,"crm");fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir,"README.md"),"mine");
const r=copyKit("dashboard",dir);
for(const f of ["package.json","KIT.md","src/App.jsx","src/i18n.js","src/data.js","src/lib/format.test.js","src/pages/Pipeline.jsx","src/components/Shell.jsx"])assert.ok(r.written.includes(f),f);
assert.ok(!r.written.some(f=>f.startsWith("node_modules")||f.startsWith("dist")),"no installed or built files");
assert.equal(fs.readFileSync(path.join(dir,"README.md"),"utf8"),"mine");
const again=copyKit("dashboard",dir);
assert.equal(again.written.length,0,"a second copy changes nothing");
assert.ok(again.kept.includes("src/App.jsx"));
assert.throws(()=>copyKit("nope",dir),/Unknown template/);
const info=detectProject(dir);
assert.equal(info.stack,"node");
for(const t of ["test","build","dev"])assert.ok(info.scripts.includes(t),t);

// through project.run
const run=createProjectRunnerAdapter();
const res=await run.execute({projectId:"panel",tool:"project.run",action:"run project task",payload:{task:"template:dashboard"}} as never) as Record<string,any>;
assert.equal(res.template,"dashboard");assert.ok(res.written.includes("src/App.jsx"));
assert.ok(fs.existsSync(path.join(root,"panel","src","pages","Tasks.jsx")));

// every word exists in both languages
const {STRINGS}=await import("../templates/dashboard-kit/src/i18n.js" as string) as {STRINGS:{en:Record<string,string>;ar:Record<string,string>}};
assert.deepEqual(Object.keys(STRINGS.ar).sort(),Object.keys(STRINGS.en).sort(),"Arabic and English have the same keys");

// ---------- dashboard goals find the guide and take the kit path ----------
for(const goal of ["ابني لي لوحة تحكم احترافية للمبيعات مثل الصور","build a professional admin dashboard for my store","اريد داشبورد CRM"]){
  assert.ok(DASHBOARD_GOAL.test(goal),goal);
  assert.equal(newProjectKind(goal),"general",goal);
  assert.ok(matchPlaybooks({goal,stack:"unknown"},2).some(p=>p.id==="builtin:pro-dashboard-ui"),"guide for: "+goal);
}
assert.ok(!DASHBOARD_GOAL.test("build a calculator page"));
assert.ok(!ANDROID_GOAL.test("build a professional admin dashboard for my store"));

console.log("dashboard-kit: kit copied safely, project.run template:dashboard, bilingual words, dashboard goals find the guide");
