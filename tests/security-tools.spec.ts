import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {PINNED_TOOLS,installPinnedTool,installedTool,readLock,sha256File,verifySha256} from "../src/platform/tool-installer.js";
import {findScanner,parseOpengrep,parseOsv,runExternalScanners} from "../src/autonomy/external-scanners.js";
import {securityReport} from "../src/autonomy/security-scan.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-tools-"));
// 1. Every pinned tool names an exact version and a full SHA-256; nothing points at "latest".
for(const t of PINNED_TOOLS){
  assert.match(t.version,/^\d+\.\d+\.\d+$/,t.name);
  assert.match(t.windows.sha256,/^[a-f0-9]{64}$/,t.name);
  assert.ok(t.windows.url.includes(t.version)&&!/latest/i.test(t.windows.url),t.name+" url is version-pinned");
}

// 2. Install flow with a fake download: the right bytes install, wrong bytes are refused and deleted.
const good=Buffer.from("fake-exe-bytes");
const tool={...PINNED_TOOLS[1]!,windows:{...PINNED_TOOLS[1]!.windows,sha256:createHash("sha256").update(good).digest("hex")}};
const fetchOk=(async()=>new Response(good,{status:200})) as unknown as typeof fetch;
const entry=await installPinnedTool(tool,{dir,fetcher:fetchOk});
assert.equal(entry.sha256,tool.windows.sha256);
assert.equal(installedTool(tool.name,dir),path.join(dir,tool.windows.exe));
fs.writeFileSync(path.join(dir,tool.windows.exe),"tampered");
assert.equal(installedTool(tool.name,dir),null,"a replaced binary is not used");
const fetchBad=(async()=>new Response(Buffer.from("malicious"),{status:200})) as unknown as typeof fetch;
await assert.rejects(installPinnedTool({...tool,name:"evil"},{dir,fetcher:fetchBad}),/SHA-256 mismatch/);
assert.ok(!fs.readdirSync(dir).some(f=>f.includes("evil")),"the mismatching download is deleted");
assert.equal(readLock(dir).length,1);
const f=path.join(dir,"x.bin");fs.writeFileSync(f,"abc");
assert.equal(sha256File(f),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
assert.throws(()=>verifySha256(f,"00"),/mismatch/);

// 3. Report parsers (formats of osv-scanner v2 and opengrep --json).
const osv=parseOsv(JSON.stringify({results:[{source:{path:"/p/package-lock.json"},packages:[{package:{name:"lodash",version:"4.17.15",ecosystem:"npm"},groups:[{ids:["GHSA-p6mc-m468-83gw"],max_severity:"7.4"}],vulnerabilities:[{id:"GHSA-p6mc-m468-83gw",summary:"Prototype pollution"}]}]}]}));
assert.equal(osv[0]!.severity,"high");assert.match(osv[0]!.message,/lodash 4\.17\.15 \(npm\) GHSA-p6mc-m468-83gw - Prototype pollution/);
const og=parseOpengrep(JSON.stringify({results:[{check_id:"config.opengrep-rules.layanx.js.eval",path:path.join(dir,"src","a.js"),start:{line:3},extra:{message:"Dynamic code execution",severity:"ERROR"}}]}),dir);
assert.deepEqual({rule:og[0]!.rule,severity:og[0]!.severity,file:og[0]!.file,line:og[0]!.line},{rule:"layanx.js.eval",severity:"high",file:"src/a.js",line:3});

// The bundled Opengrep rules: every pattern is a YAML block scalar ("shell: true" inside a plain value broke the file once).
const rules=fs.readFileSync(new URL("../config/opengrep-rules.yml",import.meta.url),"utf8").split("\n");
const plain=rules.filter(l=>/^\s*(- )?(pattern|pattern-not|pattern-inside): /.test(l)&&!/: \|\s*$/.test(l));
assert.deepEqual(plain,[],"pattern lines must use block scalars");
assert.equal(rules.filter(l=>/^\s+- id: layanx\./.test(l)).length,12);

// 4. Absent scanners are skipped cleanly and reported; the report lists them.
const env={...process.env,LAYANX_TOOLS_DIR:path.join(dir,"none"),LAYANX_SCANNERS_FROM_PATH:"off"};
assert.equal(findScanner("gitleaks",env),null);
const skipped=await runExternalScanners(dir,env);
assert.deepEqual(skipped.map(r=>[r.tool,r.ran,r.note]),[["gitleaks",false,"not installed"],["osv-scanner",false,"not installed"],["opengrep",false,"not installed"]]);
process.env.LAYANX_TOOLS_DIR=path.join(dir,"none");process.env.LAYANX_SCANNERS_FROM_PATH="off";
const project=path.join(dir,"proj");fs.mkdirSync(project);fs.writeFileSync(path.join(project,"index.js"),"console.log('hi')\n");
const report=await securityReport(project,{audit:false});
assert.deepEqual(report.scanners?.map(s=>s.tool),["gitleaks","osv-scanner","opengrep"]);
delete process.env.LAYANX_TOOLS_DIR;delete process.env.LAYANX_SCANNERS_FROM_PATH;
fs.rmSync(dir,{recursive:true,force:true});
console.log("security-tools: pinned hashes, verified install, tamper detection, report parsers and graceful skipping verified");
