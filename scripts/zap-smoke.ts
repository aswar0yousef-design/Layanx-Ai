/**
 * Real OWASP ZAP baseline (pinned Docker image) against a deliberately careless local app.
 * Run by the "zap" CI job on Linux; on Windows with Docker Desktop: LAYANX_ZAP=on npx tsx scripts/zap-smoke.ts
 */
import assert from "node:assert/strict";
import {startCarelessApp} from "../tests/fixtures/careless-web-app.js";
import {webBaseline} from "../src/autonomy/web-scan.js";

const note=(level:"notice"|"error",text:string)=>{console.log(text);if(process.env.GITHUB_ACTIONS==="true")console.log(`::${level} title=ZAP smoke::${text.replace(/\r?\n/g," ").slice(0,900)}`);};
const {server,port}=await startCarelessApp(process.platform==="linux"?"127.0.0.1":"0.0.0.0");
try{
  const r=await webBaseline(`http://127.0.0.1:${port}/`,{env:{...process.env,LAYANX_ZAP:process.env.LAYANX_ZAP??"on"}});
  assert.ok(r.zap,"ZAP was attempted");
  assert.equal(r.zap.ran,true,"ZAP ran: "+(r.zap.note??""));
  assert.ok(r.zap.alerts>0,"ZAP reported alerts");
  const fromZap=r.findings.filter(f=>f.message.startsWith("ZAP: "));
  const builtIn=r.findings.length-fromZap.length;
  assert.ok(!fromZap.some(f=>r.findings.some(n=>!n.message.startsWith("ZAP: ")&&n.rule.split(".").slice(0,2).join(".")===f.rule)),"ZAP duplicates of built-in findings are dropped");
  note("notice",`PASS ZAP ${r.zap.image} baseline: ${r.zap.alerts} alerts, ${fromZap.length} added beyond the ${builtIn} built-in findings (${[...new Set(fromZap.map(f=>f.rule))].join(",")}); ${r.pages.length} pages crawled`);
}catch(e){note("error","FAIL "+(e instanceof Error?e.message:String(e)));process.exitCode=1;}
finally{server.close();}
