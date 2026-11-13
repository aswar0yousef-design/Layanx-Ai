/**
 * Live screen vision, judged from outside. A test window shows a random word and number in large type; the owner's question
 * goes through LayanX's real path (agent captures the screen, the vision model answers from the picture). Then the window
 * changes and the same question is asked again: the second answer must give the NEW values, so a stale picture fails.
 * Only a screenshot is taken (no mouse or keyboard). It never runs beside a trading terminal. The picture stays on this PC
 * (local models only).
 *
 *   npx tsx scripts/outcome-screen-vision-acceptance.ts --runs 3
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {execFileSync,spawn} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {applyLiveModelPlan,liveModelPlan} from "./live-models.js";

if(process.platform!=="win32"){console.log("screen-vision: Windows only");process.exit(0);}
const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const ps=(script:string)=>execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",windowsHide:true,timeout:30000}).trim();
const trading=ps("@(Get-Process -Name terminal64,terminal,metatrader,mt5 -ErrorAction SilentlyContinue).Count");
if(Number(trading)>0&&process.env.LAYANX_DESKTOP_TRIAL_WITH_TRADING!=="1"){console.log(JSON.stringify({ok:false,stage:"skipped",reason:"a trading terminal (MetaTrader) is open"}));process.exit(2);}

const WORDS=[["تفاحة","apple"],["قمر","moon"],["جبل","mountain"],["بحر","sea"],["نخلة","palm"],["قلم","pen"],["سيارة","car"],["شمس","sun"]];
const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-screen-vision-"+randomUUID().slice(0,6));
const store=path.join(root,"store"),projects=path.join(root,"projects");
fs.mkdirSync(store,{recursive:true});fs.mkdirSync(projects,{recursive:true});
const stateFile=path.join(root,"window.txt");
/** A topmost window that shows whatever stateFile says, re-read every 300 ms; closed by its PID at the end. */
function showWindow(){
  const script=`Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$f=New-Object Windows.Forms.Form;$f.Text='LayanX vision test';$f.TopMost=$true;$f.StartPosition='CenterScreen';$f.Width=1100;$f.Height=560;$f.BackColor='White'
$l=New-Object Windows.Forms.Label;$l.Dock='Fill';$l.TextAlign='MiddleCenter';$l.Font=New-Object Drawing.Font('Segoe UI',72,[Drawing.FontStyle]::Bold);$l.ForeColor='Black';$f.Controls.Add($l)
$t=New-Object Windows.Forms.Timer;$t.Interval=300;$t.Add_Tick({try{$l.Text=[IO.File]::ReadAllText('${stateFile.replace(/'/g,"''")}',[Text.Encoding]::UTF8)}catch{}});$t.Start()
$f.Add_Shown({$f.Activate()});[Windows.Forms.Application]::Run($f)`;
  return spawn("powershell.exe",["-NoProfile","-STA","-Command",script],{windowsHide:false,stdio:"ignore"});
}
const pick=()=>{const w=WORDS[Math.floor(Math.random()*WORDS.length)]!;return{ar:w[0]!,en:w[1]!,n:String(100+Math.floor(Math.random()*900))};};
// Arabic-Indic digits, vowel marks and ة/ه spellings do not change the word that was read.
const toLatin=(t:string)=>t.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[ً-ْـ]/g,"").replace(/ة/g,"ه");

Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_BUSINESS_STORAGE_PATH:path.join(root,"business.json"),
  LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
  LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off"});
const models=applyLiveModelPlan();
const {createRuntime}=await import("../src/runtime.js");
const {composeTaskAnswer}=await import("../src/core/task-answer.js");
const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
const core:any=runtime.core;
const goal="التقط صورة للشاشة وأخبرني: ما الكلمة والرقم المكتوبان بخط كبير في نافذة LayanX vision test؟";

async function ask(projectId:string){
  const began=Date.now();
  let result:any;
  try{
    result=await core.runAgentGateway(goal,projectId,6,{},"core",{preferLocal:true});
    for(let round=0;round<4&&result?.paused&&result.approvalId;round++){
      core.executionRuntime.approvals.approve(result.approvalId);
      result=await core.executeAgentLoop(result.missionId,projectId,6,{[result.nextToolIndex]:result.approvalId},"core");
    }
  }catch(error){return{answer:"",error:String((error as Error).message).slice(0,300),seconds:(Date.now()-began)/1000};}
  const answer=result?.results?await composeTaskAnswer(core.modelExecution,goal,result.results,result.completed===true).catch(e=>({text:"",error:String(e)})):null;
  return{answer:(answer as any)?.text??"",fromImage:(answer as any)?.fromImage,modelId:(answer as any)?.modelId,tools:(result?.results??[]).map((r:any)=>`${r.tool}:${r.ok?"ok":"fail"}`),seconds:Math.round((Date.now()-began)/100)/10};
}
const judge=(answer:string,v:{ar:string;en:string;n:string})=>{const t=toLatin(answer);return{word:t.includes(toLatin(v.ar))||new RegExp("\\b"+v.en+"\\b","i").test(t),number:new RegExp("(?:^|\\D)"+v.n+"(?:\\D|$)").test(t)};};

const runs=Number(arg("runs")??"3"),records:any[]=[];
const win=showWindow();
try{
  for(let run=1;run<=runs;run++){
    const steps:any[]=[];
    let previous:{ar:string;en:string;n:string}|undefined;
    for(const phase of ["first","changed"] as const){
      let v=pick();while(previous&&(v.ar===previous.ar||v.n===previous.n))v=pick();
      fs.writeFileSync(stateFile,`${v.ar}  ${v.n}`,"utf8");
      await new Promise(r=>setTimeout(r,1500));
      const r=await ask(`vision-${run}-${phase}`);
      const j=judge(r.answer,v),stale=previous?judge(r.answer,previous):{word:false,number:false};
      // The owner must read words: an answer that shows JSON or tool names fails even when the values are inside it.
      const code=/^\s*[\[{]|"tool_?\w*"\s*:/.test(String(r.answer));
      steps.push({phase,shown:`${v.ar} ${v.n}`,...r,ok:j.word&&j.number&&!(stale.number)&&!code,word:j.word,number:j.number,staleNumber:stale.number,showsCode:code});
      console.log(`run ${run} ${phase}: shown «${v.ar} ${v.n}» -> ${steps.at(-1).ok?"PASS":"FAIL"} (${r.seconds}s) «${String(r.answer).replace(/\s+/g," ").slice(0,160)}»`);
      previous=v;
    }
    records.push({run,ok:steps.every(s=>s.ok),steps});
  }
}finally{try{execFileSync("taskkill",["/PID",String(win.pid),"/T","/F"],{windowsHide:true});}catch{}}
const steps=records.flatMap(r=>r.steps);
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,answers:steps.length,correct:steps.filter(s=>s.ok).length,stale:steps.filter(s=>s.staleNumber).length,showsCode:steps.filter(s=>s.showsCode).length,medianSeconds:steps.map(s=>s.seconds).sort((a,b)=>a-b)[Math.floor(steps.length/2)]};
const text=JSON.stringify({ok:summary.passed===summary.runs,models,plan:liveModelPlan(),summary,records},null,2);
const file=path.join(root,"screen-vision-result.json");fs.writeFileSync(file,text);
console.log(JSON.stringify({file,sha256:createHash("sha256").update(text).digest("hex").slice(0,16).toUpperCase(),summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
