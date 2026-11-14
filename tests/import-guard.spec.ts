import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const {missingPackages,packageName}=await import("../src/tools/import-guard.js");
const {createFileWriteToolAdapter}=await import("../src/tools/fabric.js");

// ---------- which import names a package ----------
assert.equal(packageName("react-router-dom"),"react-router-dom");
assert.equal(packageName("@tanstack/react-query/devtools"),"@tanstack/react-query");
assert.equal(packageName("lodash/merge"),"lodash");
for(const s of ["./ui.jsx","../hooks/useTranslation","/src/x.js","node:fs","fs","path/posix","@/components/x","~/x","virtual:pwa","https://esm.sh/x"])assert.equal(packageName(s),undefined,s);

// ---------- only an installed project is checked ----------
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-guard-"));
const dir=path.join(root,"shop");fs.mkdirSync(dir);
const page=`import React from "react";\nimport { useTranslation } from "react-i18next";\nimport { motion } from "framer-motion";\nimport x from "./x.js";\nconst Lazy = () => import("chart.js");\nconst fs = require("node:fs");\n`;
assert.deepEqual(missingPackages(dir,page),[],"no package.json: nothing to judge");
fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name:"shop",dependencies:{react:"^18.3.1","framer-motion":"^11"}}));
assert.deepEqual(missingPackages(dir,page),[],"packages not installed yet: the project is being set up");
fs.mkdirSync(path.join(dir,"node_modules","react"),{recursive:true});
assert.deepEqual(missingPackages(dir,page).sort(),["chart.js","react-i18next"],"declared or installed ones pass, the rest are named");
fs.mkdirSync(path.join(dir,"node_modules","chart.js"),{recursive:true});
assert.deepEqual(missingPackages(dir,page),["react-i18next"],"installed without being declared still counts as present");

// ---------- files.write refuses the write and says why ----------
const write=createFileWriteToolAdapter({root});
const call=(p:string,content:string)=>write.execute({projectId:"shop",tool:"files.write",action:"write file",payload:{path:p,content}} as never);
await assert.rejects(call("src/pages/Best.jsx",page),/imports "react-i18next".*Nothing was written/s);
assert.equal(fs.existsSync(path.join(dir,"src","pages","Best.jsx")),false);
assert.equal(((await call("src/pages/Ok.jsx",`import React from "react";\nimport { t } from "../i18n.js";\nexport default () => null;\n`)) as {written:boolean}).written,true);
assert.equal(((await call("README.md","import x from \"nope\"")) as {written:boolean}).written,true,"only source files are checked");

console.log("import guard: a page that imports a package the project lacks is refused before it is written");

// ---------- a rewrite that drops an export other files import is refused ----------
{
  const {brokenImporters,namedExports}=await import("../src/tools/import-guard.js");
  assert.deepEqual([...namedExports("export const a=1;\nexport function b(){}\nexport { c, d as e };\nexport default x;\nexport * from './y.js';")].sort(),["a","b","c","e"]);
  fs.mkdirSync(path.join(dir,"src","components"),{recursive:true});
  fs.writeFileSync(path.join(dir,"src","components","ui.jsx"),"export function Glass(){}\nexport function Sparkline(){}\nexport function Pill(){}\n");
  fs.writeFileSync(path.join(dir,"src","pages","Overview.jsx"),`import { Glass, Sparkline as Spark } from "../components/ui.jsx";\nexport default () => null;\n`);
  const ui=path.join(dir,"src","components","ui.jsx");
  assert.deepEqual(brokenImporters(dir,ui,"export function Glass(){}\n"),["src/pages/Overview.jsx imports Sparkline"],"Pill is unused, Sparkline is not");
  assert.deepEqual(brokenImporters(dir,ui,"export function Glass(){}\nexport function Sparkline(){}\nexport function StatCard(){}\n"),[],"adding and removing unused exports is fine");
  assert.deepEqual(brokenImporters(dir,path.join(dir,"src","new.jsx"),"export const x=1;"),[],"a new file breaks nothing");
  await assert.rejects(call("src/components/ui.jsx","export function Glass(){}\n"),/drops exports other files still use: src\/pages\/Overview.jsx imports Sparkline.*Nothing was written/s);
  assert.match(fs.readFileSync(ui,"utf8"),/Sparkline/,"the file was left as it was");
}
console.log("import guard: a rewrite that drops an export another file imports is refused");
