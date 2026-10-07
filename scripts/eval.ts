/**
 * Evaluate the planner with local models (planning, Arabic, prompt-injection red team).
 *
 *   npm run eval                                  # the model Ollama runs for LayanX (OLLAMA_MODEL) or the first installed
 *   npm run eval -- --models qwen2.5:7b,llama3.1:8b  # compare models on this PC
 *   npm run eval -- --suite safety --min-pass 0.8    # one suite; exit code 1 below 80 %
 *
 * Runs only on this computer (Ollama); nothing is executed - the planner's choices are only graded.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {formatReports,loadCases,runEvals,unknownTools,type EvalReport} from "../src/evals/harness.js";

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const base=(process.env.OLLAMA_BASE_URL??"http://127.0.0.1:11434").replace(/\/$/,"");
const annotate=(level:"notice"|"error",text:string)=>{if(process.env.GITHUB_ACTIONS==="true")console.log(`::${level} title=Planner evals::${text.replace(/\r?\n/g," ").slice(0,900)}`);};

const installed=await fetch(base+"/api/tags",{signal:AbortSignal.timeout(5000)}).then(r=>r.json() as Promise<{models?:Array<{name:string}>}>).then(j=>(j.models??[]).map(m=>m.name)).catch(()=>null);
if(!installed){console.error(`Ollama is not reachable at ${base}. Start Ollama first.`);process.exit(2);}
const chat=installed.filter(m=>!/embed|bge|nomic|minilm|moondream|llava/i.test(m));
const requested=(arg("--models")??arg("--model")??"").split(",").map(s=>s.trim()).filter(Boolean);
const models=requested.length?requested:[process.env.OLLAMA_MODEL&&installed.includes(process.env.OLLAMA_MODEL)?process.env.OLLAMA_MODEL:chat[0]].filter((m):m is string=>Boolean(m));
if(!models.length){console.error("No chat model is installed in Ollama (ollama pull qwen2.5:7b).");process.exit(2);}

const suite=arg("--suite");
const cases=loadCases(path.join(root,"evals")).filter(c=>!suite||c.suite===suite);
const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-eval-"));
const reports:EvalReport[]=[];
for(const model of models){
  if(!installed.some(m=>m===model||m===model+":latest")){console.log(`skip ${model}: not installed (ollama pull ${model})`);continue;}
  Object.assign(process.env,{OLLAMA_MODEL:model,OLLAMA_VISION_MODEL:"",LAYANX_AI_MODE:"local",LAYANX_OLLAMA_ROUTING:"single",LAYANX_STORE_DIR:path.join(store,model.replace(/[^\w.-]/g,"_")),LAYANX_CAPABILITIES:process.env.LAYANX_CAPABILITIES??"all",LAYANX_DESKTOP_PREWARM:"off",LAYANX_SEMANTIC_MEMORY:"off"});
  const {createRuntime}=await import("../src/runtime.js");
  const {AiMissionPlanner}=await import("../src/core/ai-planner.js");
  const runtime=createRuntime({storagePath:path.join(process.env.LAYANX_STORE_DIR!,"runtime.json")}) as any;
  const core=runtime.core??runtime;
  const contract=core.agents.get("core");
  const catalog=core.toolCatalog.list(contract,contract.requiredPermission);
  const missing=unknownTools(cases,catalog);
  if(missing.length){console.error("Eval cases mention tools that do not exist: "+missing.join(", "));process.exit(2);}
  let calls=0;
  const planner=new AiMissionPlanner({execute:(r:unknown)=>{calls++;return core.modelExecution.execute(r);}} as any);
  console.log(`\n${model}: ${cases.length} cases`);
  const report=await runEvals(planner,catalog,cases,{model,countCalls:()=>calls,
    catalogFor:c=>c.kind==="next"?core.toolCatalog.list(contract,c.permission):catalog,
    onCase:r=>console.log(`  ${r.pass?"PASS":"FAIL"} ${r.id} (${(r.ms/1000).toFixed(1)} s) ${r.pass?r.tools.join(","):r.reasons.join("; ")}`)});
  reports.push(report);
  annotate(report.passRate>=Number(arg("--min-pass")??0)?"notice":"error",`${model}: ${report.passed}/${report.cases.length} passed (${Object.entries(report.suites).map(([s,v])=>`${s} ${v.passed}/${v.total}`).join(", ")}), ${report.errors} planner errors, avg ${(report.avgMs/1000).toFixed(1)} s`);
}
console.log("\n"+formatReports(reports));
const out=arg("--json")??path.join(process.env.LAYANX_EVAL_DIR??path.join(root,".layanx","evals"),`eval-${new Date().toISOString().replace(/[:.]/g,"-")}.json`);
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(reports,null,1));
console.log("\nReport: "+out);
fs.rmSync(store,{recursive:true,force:true});
const min=arg("--min-pass");
process.exit(min!==undefined&&reports.some(r=>r.passRate<Number(min))?1:0);
