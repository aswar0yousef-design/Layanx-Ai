/**
 * Real bugs from a real open-source project. Each case is a bug its maintainers fixed: the project is rolled back to the
 * commit before the fix, the maintainers' own regression test is added (it fails), and LayanX gets a user-style report.
 * LayanX never sees the fix. The judge, which LayanX also never sees: the project's whole test suite, the tests unchanged,
 * a small change, and hidden behaviour checks that pass on the maintainers' fix and fail before it.
 *
 *   npx tsx scripts/outcome-real-repo-repair-acceptance.ts --runs 1 [--case qs-sentinel-delimiter]
 *
 * One setup change, stated in every report: package.json "test" is set to "tape test/*.js" (the project's own tests).
 * The real "npm test" also runs lint, a Linux-only format check and a network audit, which fail on Windows for reasons
 * that have nothing to do with the bug.
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
interface Case{id:string;url:string;fix:string;report:string;hidden:string;maxLines:number}
const QS="https://github.com/ljharb/qs.git";
const CASES:Case[]=[
  {id:"qs-sentinel-delimiter",url:QS,fix:"a0a81ea",maxLines:20,
   report:"عندي عطل في مكتبة qs. عند استخدام qs.stringify مع charsetSentinel: true وفاصل مخصص مثل delimiter: ';' يظهر بعد utf8=✓ الرمز & بدل الفاصل الذي اخترته، فيفسد الناتج عند من يقرأه بالفاصل ';'. اكتشف السبب من الكود وأصلحه بأقل تغيير، ولا تعدّل الاختبارات.",
   hidden:`assert.equal(qs.stringify({a:'b',c:'d'},{charsetSentinel:true,delimiter:';'}),'utf8=%E2%9C%93;a=b;c=d');
assert.equal(qs.stringify({a:'b'},{charsetSentinel:true,charset:'iso-8859-1',delimiter:'|'}),'utf8=%26%2310003%3B|a=b');
assert.equal(qs.stringify({a:'b'},{charsetSentinel:true}),'utf8=%E2%9C%93&a=b');`},
  {id:"qs-lowercase-dot",url:QS,fix:"05a8755",maxLines:20,
   report:"عندي عطل في مكتبة qs. عند qs.parse مع الخيار decodeDotInKeys: true، المفتاح الذي فيه %2E بأحرف كبيرة يتحول إلى نقطة كما هو متوقع، لكن نفس المفتاح مع %2e بأحرف صغيرة لا يتحول. الترميز بالنسبة المئوية لا يفرق بين الأحرف الكبيرة والصغيرة. اكتشف السبب وأصلحه بأقل تغيير، ولا تعدّل الاختبارات.",
   hidden:`assert.deepEqual(qs.parse('name%252eobj.first=John',{decodeDotInKeys:true,allowDots:true}),qs.parse('name%252Eobj.first=John',{decodeDotInKeys:true,allowDots:true}));
assert.deepEqual(qs.parse('a[b%2ec]=d',{decodeDotInKeys:true}),qs.parse('a[b%2Ec]=d',{decodeDotInKeys:true}));`},
  {id:"qs-filter-sorted",url:QS,fix:"54f7f3b",maxLines:20,
   report:"عندي عطل في مكتبة qs. عندما أمرر مصفوفة filter إلى qs.stringify مع خيار sort، تتغير مصفوفتي الأصلية نفسها ويصبح ترتيبها مختلفاً بعد الاستدعاء، مع أن المكتبة يجب ألا تعدّل ما أمرره لها. اكتشف السبب وأصلحه بأقل تغيير، ولا تعدّل الاختبارات.",
   hidden:`const f=['c','a','b'];const out=qs.stringify({a:1,b:2,c:3},{filter:f,sort:(x,y)=>x.localeCompare(y)});
assert.deepEqual(f,['c','a','b']);assert.equal(out,'a=1&b=2&c=3');
const g=['z','y'];qs.stringify({y:{z:1},z:2},{filter:g,sort:(x,y)=>x.localeCompare(y)});assert.deepEqual(g,['z','y']);`}
];

const run=(cmd:string,args:string[],cwd:string,timeout=600_000)=>spawnSync(cmd,args,{cwd,encoding:"utf8",windowsHide:true,timeout,maxBuffer:64*1024*1024,shell:process.platform==="win32"&&/^(npm|npx)$/.test(cmd)});
const git=(cwd:string,...args:string[])=>{const r=run("git",["-c","user.name=harness","-c","user.email=h@local.invalid",...args],cwd);if(r.status!==0)throw new Error("git "+args.join(" ")+": "+r.stderr);return r.stdout;};
const tape=(dir:string)=>run(process.execPath,[path.join(dir,"node_modules","tape","bin","tape"),...fs.readdirSync(path.join(dir,"test")).filter(f=>f.endsWith(".js")).map(f=>"test/"+f)],dir,300_000);
function hiddenCheck(dir:string,code:string,root:string){
  const file=path.join(root,"hidden-"+randomUUID().slice(0,6)+".cjs");
  fs.writeFileSync(file,`const assert=require('node:assert/strict');const qs=require(${JSON.stringify(path.join(dir,"lib","index.js"))});\n${code}\nconsole.log('hidden ok');`);
  const r=run(process.execPath,[file],dir,30_000);
  return{ok:r.status===0,detail:(r.stderr||r.stdout).split("\n").slice(0,6).join("\n")};
}

/** A clean copy at the commit before the fix, with the maintainers' regression test added and dependencies installed. */
function prepare(selected:Case,cache:string,workspace:string){
  if(!fs.existsSync(cache)){fs.mkdirSync(path.dirname(cache),{recursive:true});git(path.dirname(cache),"clone","-q",selected.url,cache);}
  git(os_tmp(),"clone","-q","--no-hardlinks",cache,workspace);
  git(workspace,"remote","remove","origin");
  const parent=git(workspace,"rev-parse",selected.fix+"^").trim();
  const testFiles=git(workspace,"diff","--name-only",parent,selected.fix,"--","test").trim().split("\n").filter(Boolean);
  const sourceFiles=git(workspace,"diff","--name-only",parent,selected.fix,"--",".",":(exclude)test").trim().split("\n").filter(Boolean);
  git(workspace,"checkout","-q","-B","main",parent);
  const install=run("npm",["install","--ignore-scripts","--no-audit","--no-fund","--loglevel=error"],workspace,900_000);
  if(install.status!==0)throw new Error("npm install failed: "+(install.stderr||install.stdout).slice(-800));
  const pkgFile=path.join(workspace,"package.json"),pkg=JSON.parse(fs.readFileSync(pkgFile,"utf8"));
  pkg.scripts={...pkg.scripts,test:"tape test/*.js"};delete pkg.scripts.pretest;delete pkg.scripts.posttest;
  fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+"\n");
  git(workspace,"add","package.json");git(workspace,"commit","-q","-m","Run the project's own tests on Windows");
  git(workspace,"checkout",selected.fix,"--",...testFiles);
  git(workspace,"commit","-q","-m","Add a test that shows the reported bug");
  return{parent,testFiles,sourceFiles,base:git(workspace,"rev-parse","HEAD").trim()};
}
const os_tmp=()=>process.env.TEMP??process.env.TMPDIR??"/tmp";

async function runOne(selected:Case){
  const id="realrepo-"+selected.id+"-"+randomUUID().slice(0,6);
  const parentDir=path.join(resolveDataPaths().dataDir,"outcome-runs");
  const root=path.join(parentDir,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const projects=path.join(root,"projects"),store=path.join(root,"store"),workspace=path.join(projects,id);
  fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(projects,{recursive:true,mode:0o700});
  const cache=path.join(parentDir,"real-repos",selected.url.replace(/^.*\/([^/]+?)(?:\.git)?$/,"$1"));
  const setup=prepare(selected,cache,workspace);
  const finish=(record:Record<string,unknown>)=>{
    const file=path.join(root,"real-repo-result.json");
    fs.writeFileSync(file,JSON.stringify({case:selected.id,url:selected.url,upstreamFix:selected.fix,setupNote:"package.json test set to 'tape test/*.js' (lint, Linux-only format check and audit left out)",workspace,...record},null,2),{mode:0o600});
    console.log("RESULT_FILE="+file);
  };
  // The scenario must be real: the bug shows before, and the hidden checks pass on the maintainers' own fix.
  const suiteBefore=tape(workspace);
  const hiddenBefore=hiddenCheck(workspace,selected.hidden,root);
  const upstream=path.join(root,"upstream");
  git(os_tmp(),"clone","-q","--no-hardlinks",workspace,upstream);git(upstream,"checkout","-q",selected.fix,"--",...setup.sourceFiles);
  fs.cpSync(path.join(workspace,"node_modules"),path.join(upstream,"node_modules"),{recursive:true});
  const hiddenUpstream=hiddenCheck(upstream,selected.hidden,root),suiteUpstream=tape(upstream);
  fs.rmSync(upstream,{recursive:true,force:true});
  if(suiteBefore.status===0||hiddenBefore.ok||!hiddenUpstream.ok||suiteUpstream.status!==0){
    finish({ok:false,stage:"baseline",suiteFailsBefore:suiteBefore.status!==0,hiddenFailsBefore:!hiddenBefore.ok,hiddenPassesUpstream:hiddenUpstream.ok,suitePassesUpstream:suiteUpstream.status===0,hiddenUpstream:hiddenUpstream.detail});
    return;
  }
  Object.assign(process.env,{
    LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
    LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),
    LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),
    LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
    OLLAMA_MODEL:process.env.OLLAMA_MODEL||"gpt-oss:20b"
  });
  const model=process.env.OLLAMA_MODEL!;
  process.env.LAYANX_OLLAMA_MODEL_PLAN??=JSON.stringify({general:model,planning:model,coding:model,fast:model});
  const {discoverOllama,buildModelLadders}=await import("../src/providers/ollama-discovery.js");
  process.env.LAYANX_OLLAMA_MODEL_LADDER=JSON.stringify(buildModelLadders(await discoverOllama(process.env.OLLAMA_BASE_URL,{timeoutMs:3000})));
  const {setTrust}=await import("../src/autonomy/trust.js");
  const {setIsolation}=await import("../src/autonomy/sandbox.js");
  const {createRuntime}=await import("../src/runtime.js");
  const {Supervisor}=await import("../src/autonomy/supervisor.js");
  const {coreSupervisorDeps}=await import("../src/autonomy/runtime-deps.js");
  setTrust(process.env.LAYANX_TRUST_FILE,id,"trusted");setIsolation(process.env.LAYANX_ISOLATION_FILE,id,"no-scripts");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const supervisor=new Supervisor(coreSupervisorDeps(runtime.core),{file:path.join(store,"supervisor-jobs.json"),pollMs:500});
  const started=Date.now();
  const job=supervisor.create(selected.report,id,{maxMinutes:25,maxRounds:12,openWhenDone:false,acceptanceProfile:"node-repair-v1"});
  let seen=0;
  while(["planning","running","verifying","queued"].includes(job.status)&&Date.now()-started<26*60_000){
    await new Promise(r=>setTimeout(r,1000));
    for(const entry of job.log.slice(seen))console.error("[job] "+entry.msg.slice(0,240));
    seen=job.log.length;
  }
  supervisor.stop();
  const suiteAfter=tape(workspace),hiddenAfter=hiddenCheck(workspace,selected.hidden,root);
  git(workspace,"add","-A");
  const changed=git(workspace,"diff","--cached","--numstat",setup.base,"--",".",":(exclude).layanx",":(exclude)node_modules").trim().split("\n").filter(Boolean).map(line=>line.split("\t"));
  const lines=changed.reduce((sum,row)=>sum+(Number(row[0])||0)+(Number(row[1])||0),0);
  const testsTouched=changed.some(row=>/^test\/|package\.json/.test(row[2]!));
  const fixed=suiteAfter.status===0&&hiddenAfter.ok,claimed=job.status==="completed";
  finish({
    ok:fixed&&claimed&&!testsTouched&&lines>0&&lines<=selected.maxLines,falseSuccess:claimed&&!fixed,
    jobStatus:job.status,minutes:Math.round((Date.now()-started)/6000)/10,fixed,claimed,testsTouched,lines,
    changedFiles:changed.map(r=>r[2]),patch:git(workspace,"diff","--cached",setup.base,"--",".",":(exclude).layanx",":(exclude)node_modules").slice(0,6000),
    upstreamPatch:git(cache,"show",selected.fix,"--",...setup.sourceFiles).slice(0,4000),
    hidden:hiddenAfter.ok?"ok":hiddenAfter.detail,suiteTail:(suiteAfter.stdout||"").split("\n").slice(-8).join("\n"),
    handoffs:job.modelRun?.handoffs.length??0,attempts:job.modelRun?.attempts.map((a:any)=>({model:a.model,outcome:a.outcome}))??[],
    result:job.result?.slice(0,800),log:job.log.slice(-14).map((l:any)=>l.msg.slice(0,260))
  });
}

if(process.argv.includes("--one")){
  await runOne(CASES.find(c=>c.id===arg("one"))!);
  process.exit(0);
}
const runs=Number(arg("runs")??"1"),only=arg("case");
const records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  console.log(`=== ${selected.id} run ${i}/${runs}`);
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:40*60_000,maxBuffer:128*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",exit:child.status,stderr:(child.stderr??"").slice(-1500)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,stage:record.stage,status:record.jobStatus,fixed:record.fixed,falseSuccess:record.falseSuccess,lines:record.lines,files:record.changedFiles,minutes:record.minutes,hidden:record.ok?undefined:record.hidden,result:record.ok?undefined:record.result,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length,byCase:Object.fromEntries(CASES.filter(c=>!only||c.id===only).map(c=>[c.id,`${records.filter(r=>r.case===c.id&&r.ok).length}/${records.filter(r=>r.case===c.id).length}`]))};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","real-repo-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2),{mode:0o600});
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
