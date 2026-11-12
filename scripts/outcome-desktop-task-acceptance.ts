/**
 * Real applications driven from the owner's words, judged from outside. LayanX's agent gets a goal ("open Notepad and
 * write ...", "open Calculator and compute ..."); afterwards Windows UI Automation reads what is really in the new window.
 * It takes over the mouse and keyboard, so it runs only when nobody has touched them for 5 minutes, and it closes only the
 * windows it opened (the owner's own Notepad or Calculator are left alone).
 *
 *   npx tsx scripts/outcome-desktop-task-acceptance.ts --runs 1 [--case notepad] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

if(process.platform!=="win32"){console.log("desktop-task: Windows only");process.exit(0);}
const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const ps=(script:string)=>execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",windowsHide:true,timeout:30000}).trim();
const userIdleMs=()=>Number(ps("Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class LxI{[StructLayout(LayoutKind.Sequential)]struct L{public uint s;public uint t;}[DllImport(\"user32.dll\")]static extern bool GetLastInputInfo(ref L l);public static uint Ms(){L l=new L();l.s=8;GetLastInputInfo(ref l);return (uint)Environment.TickCount-l.t;}}';[LxI]::Ms()"))||0;
const pids=(names:string[])=>new Set(ps(`@(Get-Process -Name ${names.join(",")} -ErrorAction SilentlyContinue) | ForEach-Object { $_.Id }; exit 0`).split(/\s+/).filter(Boolean).map(Number));
// A trading terminal with a real account may be open: a keystroke that lands in the wrong window must never reach it.
const TRADING=["terminal64","terminal","metatrader","mt5"];
/** Every text UI Automation can read in the windows of these processes. */
function windowTexts(ids:number[]):string{
  if(!ids.length)return"";
  return ps(`Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$out=@()
foreach($p in @(${ids.join(",")})){
  $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$p)
  foreach($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$c)){
    $out+=$w.Current.Name
    foreach($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)){
      $out+=$e.Current.Name
      try{$v=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$out+=$v.Current.Value}catch{}
      try{$t=$e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern);$out+=$t.DocumentRange.GetText(2000)}catch{}
    }
  }
}
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$out -join "\`n"`);
}
interface Case{id:string;processes:string[];goal:(marker:string)=>string;judge:(text:string,marker:string)=>Array<{check:string;ok:boolean;detail?:string}>}
const CASES:Case[]=[
  {id:"notepad",processes:["notepad"],goal:m=>`افتح المفكرة واكتب فيها هذا السطر بالضبط: تقرير LayanX ${m}`,
   judge:(t,m)=>[{check:"Notepad shows the line",ok:t.includes(`تقرير LayanX ${m}`)||t.includes(`LayanX ${m}`),detail:t.slice(0,300)}]},
  {id:"calculator",processes:["CalculatorApp","calc"],goal:()=>"افتح الحاسبة واحسب 125 × 8",
   judge:t=>[{check:"Calculator shows 1000",ok:/(?:^|\D)1[,٬]?000(?:\D|$)/.test(t)||/Display is 1[,٬]?000/.test(t),detail:t.replace(/\s+/g," ").slice(0,300)}]}
];

async function runOne(selected:Case){
  const id="desktop-"+selected.id+"-"+randomUUID().slice(0,6),marker=randomUUID().slice(0,6);
  const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const store=path.join(root,"store"),projects=path.join(root,"projects");
  fs.mkdirSync(store,{recursive:true});fs.mkdirSync(path.join(projects,id),{recursive:true});
  const finish=(record:Record<string,unknown>)=>{const file=path.join(root,"desktop-result.json");fs.writeFileSync(file,JSON.stringify({case:selected.id,...record},null,2));console.log("RESULT_FILE="+file);};
  const idle=userIdleMs();
  if(idle<5*60_000&&!process.argv.includes("--force")){finish({ok:false,stage:"skipped",reason:`someone used the keyboard or mouse ${Math.round(idle/1000)} s ago`});return;}
  const trading=pids(TRADING);
  if(trading.size&&process.env.LAYANX_DESKTOP_TRIAL_WITH_TRADING!=="1"){finish({ok:false,stage:"skipped",reason:"a trading terminal (MetaTrader) is open; desktop trials never run beside it"});return;}
  const before=pids(selected.processes);
  Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
    LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off"});
  const {createRuntime}=await import("../src/runtime.js");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const core:any=runtime.core;
  const started=Date.now();
  let result:any,approvals:Record<number,string>={},rounds=0,approved=0;
  try{
    // The owner approving each step: this is a throwaway window task, approved here so the run measures the agent, not a person.
    for(;rounds<8;rounds++){
      result=await core.runAgentGateway(selected.goal(marker),id,12,approvals,"core",{preferLocal:true});
      if(!result?.paused||!result.approvalId)break;
      core.executionRuntime.approvals.approve(result.approvalId);approved++;
      approvals={...approvals,[result.nextToolIndex]:result.approvalId};
    }
  }catch(error){result={error:String((error as Error).message).slice(0,400)};}
  await new Promise(r=>setTimeout(r,1500));
  const opened=[...pids(selected.processes)].filter(p=>!before.has(p));
  const text=windowTexts(opened);
  const verdict=selected.judge(text,marker);
  for(const p of opened)spawnSync("taskkill",["/PID",String(p),"/F"],{windowsHide:true});
  const works=verdict.every(v=>v.ok),claimed=result?.completed===true;
  finish({ok:works&&claimed,falseSuccess:claimed&&!works,works,claimed,minutes:Math.round((Date.now()-started)/6000)/10,approved,opened:opened.length,verdict,
    tools:(result?.results??[]).map((r:any)=>`${r.tool}:${r.ok?"ok":"fail"}`),reason:result?.reason??result?.error,workspace:path.join(projects,id)});
}

if(process.argv.includes("--one")){await runOne(CASES.find(c=>c.id===arg("one"))!);process.exit(0);}
const runs=Number(arg("runs")??"1"),only=arg("case"),records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id,...(process.argv.includes("--force")?["--force"]:[])],{encoding:"utf8",windowsHide:true,timeout:20*60_000,maxBuffer:64*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",stderr:(child.stderr??"").slice(-800)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,stage:record.stage,claimed:record.claimed,works:record.works,falseSuccess:record.falseSuccess,minutes:record.minutes,tools:record.tools,reason:record.reason,failed:record.verdict?.filter((v:any)=>!v.ok)}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,skipped:records.filter(r=>r.stage==="skipped").length,falseSuccess:records.filter(r=>r.falseSuccess).length};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","desktop-task-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2));
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
