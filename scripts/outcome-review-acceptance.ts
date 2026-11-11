/**
 * Cross-agent review against planted bugs. Each project's visible tests pass but its program has a real bug the tests do
 * not cover. The review must find it and the work must come back fixed. Each bug has a clean twin: there the review must
 * not damage correct code. Judged by inputs this script keeps to itself.
 *
 *   npx tsx scripts/outcome-review-acceptance.ts --runs 3 [--case roman-bug]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const header="import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {cli} from './helpers.mjs';\n";
const romanBody=(pairs:string)=>`const n=Number(process.argv[2]);\nif(!Number.isInteger(n)||n<1||n>3999){console.error('out of range');process.exitCode=1;}\nelse{\n  const pairs=[${pairs}];\n  let left=n,out='';\n  for(const [value,symbol] of pairs){while(left>=value){out+=symbol;left-=value;}}\n  console.log(out);\n}\n`;
const wcBody=(split:string)=>`let text='';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data',d=>{text+=d;});\nprocess.stdin.on('end',()=>{\n  const words=${split};\n  console.log(JSON.stringify({lines:(text.match(/\\n/g)||[]).length,words,chars:[...text].length}));\n});\n`;
const csvRead="let text='';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data',d=>{text+=d;});\n";
const naiveCsv=csvRead+"process.stdin.on('end',()=>{\n  if(!text){process.exitCode=1;return;}\n  const rows=text.trim().split('\\n').map(line=>line.split(','));\n  const keys=rows[0];\n  console.log(JSON.stringify(rows.slice(1).map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[i]])))));\n});\n";
const goodCsv=csvRead+"function split(line){const out=[];let cell='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(quoted){if(c==='\"'&&line[i+1]==='\"'){cell+='\"';i++;}else if(c==='\"')quoted=false;else cell+=c;}else if(c==='\"')quoted=true;else if(c===','){out.push(cell);cell='';}else cell+=c;}out.push(cell);return out;}\nprocess.stdin.on('end',()=>{\n  if(!text){process.exitCode=1;return;}\n  const rows=text.trim().split(/\\r?\\n/).map(split);\n  const keys=rows[0];\n  console.log(JSON.stringify(rows.slice(1).map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[i]])))));\n});\n";
const ROMAN_FULL="[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']";
const ROMAN_BUG="[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[50,'L'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']";
const romanGoal="Build a command-line program that converts a number given as its only argument to Roman numerals and prints only the result, using subtractive notation for all of 4, 9, 40, 90, 400 and 900. Numbers outside 1 to 3999 or non-integers print an error on stderr and exit with code 1.";
const wcGoal='Build a command-line program that reads text from standard input and prints one line of JSON with the keys lines, words and chars. chars counts characters, words are separated by any run of whitespace including tabs and repeated spaces, and lines is the number of newline characters.';
const csvGoal='Build a command-line tool that reads CSV from standard input and prints a JSON array of objects, using the first row as the keys. Quoted fields may contain commas and doubled quotes ("" means one "). All values stay strings. Completely empty input exits with code 1.';
const romanTests=header+"const r=async n=>(await cli([String(n)])).stdout.trim();\ntest('one',async()=>assert.equal(await r(1),'I'));\ntest('four',async()=>assert.equal(await r(4),'IV'));\ntest('nine',async()=>assert.equal(await r(9),'IX'));\ntest('1000',async()=>assert.equal(await r(1000),'M'));\ntest('zero fails',async()=>assert.equal((await cli(['0'])).code,1));\n";
const wcTests=header+"const r=async s=>JSON.parse((await cli([],s)).stdout);\ntest('one word',async()=>assert.equal((await r('hi')).words,1));\ntest('two words',async()=>assert.equal((await r('a b')).words,2));\ntest('lines',async()=>assert.equal((await r('a\\nb\\n')).lines,2));\ntest('chars',async()=>assert.equal((await r('abc')).chars,3));\n";
const csvTests=header+"const r=async s=>JSON.parse((await cli([],s)).stdout);\ntest('one row',async()=>assert.deepEqual(await r('a,b\\n1,2\\n'),[{a:'1',b:'2'}]));\ntest('two rows',async()=>assert.equal((await r('a\\n1\\n2\\n')).length,2));\ntest('header only',async()=>assert.deepEqual(await r('a,b\\n'),[]));\ntest('empty fails',async()=>assert.equal((await cli([],'')).code,1));\n";
interface Case{id:string;planted:boolean;goal:string;tests:string;program:string;hidden:Array<[string[],string,string]>}
const CASES:Case[]=[
  {id:"roman-bug",planted:true,goal:romanGoal,tests:romanTests,program:romanBody(ROMAN_BUG),hidden:[[["90"],"","XC"],[["1994"],"","MCMXCIV"],[["49"],"","XLIX"],[["3"],"","III"]]},
  {id:"roman-clean",planted:false,goal:romanGoal,tests:romanTests,program:romanBody(ROMAN_FULL),hidden:[[["90"],"","XC"],[["1994"],"","MCMXCIV"],[["49"],"","XLIX"],[["3"],"","III"]]},
  {id:"words-bug",planted:true,goal:wcGoal,tests:wcTests,program:wcBody("text.split(' ').filter(Boolean).length"),hidden:[[[],"a\tb  c\n",'{"lines":1,"words":3,"chars":7}'],[[],"x y",'{"lines":0,"words":2,"chars":3}']]},
  {id:"words-clean",planted:false,goal:wcGoal,tests:wcTests,program:wcBody("text.split(/\\s+/).filter(Boolean).length"),hidden:[[[],"a\tb  c\n",'{"lines":1,"words":3,"chars":7}'],[[],"x y",'{"lines":0,"words":2,"chars":3}']]},
  {id:"csv-bug",planted:true,goal:csvGoal,tests:csvTests,program:naiveCsv,hidden:[[[],'n,o\n"A, B",ok\n','[{"n":"A, B","o":"ok"}]'],[[],'x\n"s ""q"""\n','[{"x":"s \\"q\\""}]'],[[],"a\n1\n",'[{"a":"1"}]']]},
  {id:"csv-clean",planted:false,goal:csvGoal,tests:csvTests,program:goodCsv,hidden:[[[],'n,o\n"A, B",ok\n','[{"n":"A, B","o":"ok"}]'],[[],'x\n"s ""q"""\n','[{"x":"s \\"q\\""}]'],[[],"a\n1\n",'[{"a":"1"}]']]}
];
const judgeProgram=(dir:string,hidden:Case["hidden"])=>hidden.map(([args,input,want])=>{const run=spawnSync(process.execPath,[path.join(dir,"src/index.mjs"),...args],{input,encoding:"utf8",windowsHide:true,timeout:15_000});const got=(run.stdout??"").trim();return{args,want,got,ok:got===want};});
async function runOne(selected:Case){
  const id="review-"+selected.id+"-"+randomUUID().slice(0,6);
  const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
  const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const projects=path.join(root,"projects"),store=path.join(root,"store"),workspace=path.join(projects,id);
  fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(workspace,{recursive:true,mode:0o700});
  Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",OLLAMA_MODEL:process.env.OLLAMA_MODEL||"gpt-oss:20b"});
  const model=process.env.OLLAMA_MODEL!;
  process.env.LAYANX_OLLAMA_MODEL_PLAN??=JSON.stringify({general:model,planning:model,coding:model,fast:model});
  const {discoverOllama,buildModelLadders}=await import("../src/providers/ollama-discovery.js");
  process.env.LAYANX_OLLAMA_MODEL_LADDER=JSON.stringify(buildModelLadders(await discoverOllama(process.env.OLLAMA_BASE_URL,{timeoutMs:3000})));
  const {nodeSpecFiles,PROGRAM_FILE,SPEC_TEST_FILE}=await import("../src/autonomy/project-build.js");
  for(const file of nodeSpecFiles(selected.goal,selected.tests)){fs.mkdirSync(path.dirname(path.join(workspace,file.path)),{recursive:true});fs.writeFileSync(path.join(workspace,file.path),file.path===PROGRAM_FILE?selected.program:file.content);}
  const visible=spawnSync(process.execPath,["--test"],{cwd:workspace,encoding:"utf8",windowsHide:true,timeout:60_000}).status;
  const {setTrust}=await import("../src/autonomy/trust.js");
  const {setIsolation}=await import("../src/autonomy/sandbox.js");
  const {createRuntime}=await import("../src/runtime.js");
  const {Supervisor}=await import("../src/autonomy/supervisor.js");
  const {coreSupervisorDeps}=await import("../src/autonomy/runtime-deps.js");
  setTrust(process.env.LAYANX_TRUST_FILE,id,"trusted");setIsolation(process.env.LAYANX_ISOLATION_FILE,id,"no-scripts");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const supervisor=new Supervisor(coreSupervisorDeps(runtime.core),{file:path.join(store,"supervisor-jobs.json"),pollMs:500});
  const started=Date.now(),specBefore=fs.readFileSync(path.join(workspace,SPEC_TEST_FILE),"utf8"),programBefore=selected.program;
  const job=supervisor.create(selected.goal,id,{maxMinutes:20,maxRounds:12,openWhenDone:false,acceptanceProfile:"node-tool-v1"});
  while(["planning","running","verifying","queued"].includes(job.status)&&Date.now()-started<21*60_000)await new Promise(r=>setTimeout(r,1000));
  supervisor.stop();
  const hidden=judgeProgram(workspace,selected.hidden),correct=hidden.every(h=>h.ok);
  const programAfter=fs.readFileSync(path.join(workspace,PROGRAM_FILE),"utf8");
  const specKept=fs.readFileSync(path.join(workspace,SPEC_TEST_FILE),"utf8")===specBefore;
  const record={case:selected.id,planted:selected.planted,visibleBefore:visible===0,ok:correct&&specKept&&job.status==="completed",caught:selected.planted?Boolean(job.review?.agreed):undefined,correct,specKept,changed:programAfter!==programBefore,falseSuccess:job.status==="completed"&&!correct,jobStatus:job.status,review:job.review,minutes:Math.round((Date.now()-started)/6000)/10,attempts:job.milestones.map((m:any)=>m.attempts),hidden:hidden.filter(h=>!h.ok),result:job.result?.slice(0,500),log:job.log.slice(-10).map((l:any)=>l.msg.slice(0,240)),workspace};
  const file=path.join(root,"review-result.json");
  fs.writeFileSync(file,JSON.stringify(record,null,2),{mode:0o600});
  console.log("RESULT_FILE="+file);
}
if(process.argv.includes("--one")){await runOne(CASES.find(c=>c.id===arg("one"))!);process.exit(0);}
const runs=Number(arg("runs")??"1"),only=arg("case");
const records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:25*60_000,maxBuffer:128*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",exit:child.status,stderr:(child.stderr??"").slice(-800)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,status:record.jobStatus,correct:record.correct,changed:record.changed,review:record.review,falseSuccess:record.falseSuccess,attempts:record.attempts,minutes:record.minutes,hidden:record.hidden,result:record.ok?undefined:record.result,stderr:record.stderr}));
}
const planted=records.filter(r=>r.planted),clean=records.filter(r=>r.planted===false);
const summary={runs:records.length,plantedFixed:`${planted.filter(r=>r.ok).length}/${planted.length}`,plantedCaughtByReview:`${planted.filter(r=>r.caught).length}/${planted.length}`,cleanUnharmed:`${clean.filter(r=>r.ok&&!r.changed).length}/${clean.length}`,falseRejects:clean.filter(r=>(r.review?.failedFirst??0)>0).length,falseSuccess:records.filter(r=>r.falseSuccess).length};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","review-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2),{mode:0o600});
console.log(JSON.stringify({report:out,summary},null,2));
