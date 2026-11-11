/**
 * Real Windows, real actions, checked from outside. Opens a small throwaway window whose every change is written to a
 * file by the window itself, drives it through LayanX's desktop tool, and compares what the tool reported with that file.
 * The window takes the foreground for a few seconds; nothing else on the desktop is touched.
 *
 *   npx tsx scripts/outcome-desktop-effect-acceptance.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {createDesktopControlToolAdapter} from "../src/tools/desktop-control.js";
import {resolveDataPaths} from "../src/platform/paths.js";

if(process.platform!=="win32"){console.log("desktop-effect: Windows only");process.exit(0);}
const id=randomUUID().slice(0,8),title="LayanX Effect Test "+id;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-effect-")),stateFile=path.join(dir,"state.json");
const form=`
Add-Type -AssemblyName System.Windows.Forms
$f=New-Object Windows.Forms.Form;$f.Text='${title}';$f.Width=520;$f.Height=320;$f.TopMost=$true;$f.StartPosition='CenterScreen'
$state=@{name='';typed='';checked=$false;clicks=0}
function Save{ $o=[ordered]@{name=$name.Text;typed=$typed.Text;checked=$check.Checked;clicks=$script:clicks;locked=$locked.Text}; [IO.File]::WriteAllText('${stateFile.replace(/'/g,"''")}',($o|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false)) }
$script:clicks=0
$name=New-Object Windows.Forms.TextBox;$name.Name='nameBox';$name.AccessibleName='NameField';$name.Left=20;$name.Top=20;$name.Width=440;$f.Controls.Add($name)
$typed=New-Object Windows.Forms.TextBox;$typed.AccessibleName='TypedField';$typed.Left=20;$typed.Top=60;$typed.Width=440;$f.Controls.Add($typed)
$locked=New-Object Windows.Forms.TextBox;$locked.AccessibleName='LockedField';$locked.ReadOnly=$true;$locked.Text='fixed';$locked.Left=20;$locked.Top=100;$locked.Width=440;$f.Controls.Add($locked)
$check=New-Object Windows.Forms.CheckBox;$check.Text='AgreeBox';$check.Left=20;$check.Top=140;$check.Width=200;$f.Controls.Add($check)
$button=New-Object Windows.Forms.Button;$button.Text='SaveButton';$button.Left=20;$button.Top=180;$button.Width=140;$f.Controls.Add($button)
$label=New-Object Windows.Forms.Label;$label.Text='not saved';$label.Left=180;$label.Top=185;$label.Width=260;$f.Controls.Add($label)
$name.Add_TextChanged({Save});$typed.Add_TextChanged({Save});$check.Add_CheckedChanged({Save})
$button.Add_Click({$script:clicks++;$label.Text='saved '+$script:clicks;$button.Text='SaveButton '+$script:clicks;Save})
$f.Add_Shown({Save})
[void]$f.ShowDialog()
`;
const script=path.join(dir,"form.ps1");
fs.writeFileSync(script,"﻿"+form,"utf8");
const child=spawn("powershell.exe",["-NoProfile","-STA","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",script],{stdio:"ignore"});
const desktop=createDesktopControlToolAdapter();
const act=(action:string,body:Record<string,unknown>={})=>desktop.execute({missionId:"effect",agentId:"core",projectId:"effect",tool:"desktop",action,permission:"L4_EXECUTE",idempotencyKey:randomUUID(),payload:body} as never) as Promise<any>;
const state=()=>JSON.parse(fs.readFileSync(stateFile,"utf8").replace(/^﻿/,""));
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const checks:Array<{check:string;ok:boolean;detail?:unknown}>=[];
const record=(check:string,ok:boolean,detail?:unknown)=>{checks.push({check,ok,...(detail!==undefined?{detail}:{})});console.log(ok?"PASS":"FAIL",check,detail===undefined?"":JSON.stringify(detail));};
const refused=async(run:()=>Promise<unknown>)=>{try{await run();return undefined;}catch(error){return(error as Error).message;}};

try{
  for(let i=0;i<60&&!fs.existsSync(stateFile);i++)await wait(250);
  await act("desktop focus window",{title});
  const tree=await act("desktop ui tree",{});
  const element=(name:string)=>tree.elements.find((e:any)=>e.name===name||String(e.name).startsWith(name));
  record("the tool sees this window's controls",tree.window===title&&Boolean(element("NameField")&&element("SaveButton")&&element("AgreeBox")),{window:tree.window,elements:tree.elements.length});

  const arabic="مرحبا LayanX";
  const set=await act("desktop set element text",{index:element("NameField").i,text:arabic});
  await wait(200);
  record("text set through the accessibility tree really arrived",state().name===arabic&&set.effect?.verified===true,{tool:set.effect,window:state().name});

  const toggled=await act("desktop click element",{index:element("AgreeBox").i,pattern:true});
  await wait(200);
  record("check box really changed",state().checked===true&&toggled.effect?.changed===true,{tool:toggled.effect,window:state().checked});

  const clicked=await act("desktop click element",{index:element("SaveButton").i,window:title});
  await wait(300);
  record("real mouse click really pressed the button",state().clicks===1&&clicked.method==="mouse"&&clicked.effect?.changed===true,{tool:clicked,windowClicks:state().clicks});

  await act("desktop click element",{index:element("TypedField").i,window:title});
  const text="كتابة حقيقية 123";
  const typed=await act("desktop type",{text,window:title});
  await wait(300);
  record("real keyboard typing (Arabic) really arrived",state().typed===text&&typed.effect?.verified===true,{tool:typed.effect,window:state().typed});

  const beforeGuard=state();
  const guard=await refused(()=>act("desktop type",{text:"should not appear",window:"A window that is not in front"}));
  await wait(200);
  record("typing is refused when another window is in front",Boolean(guard&&/Nothing was sent/.test(guard))&&state().typed===beforeGuard.typed,guard);

  const lockedResult=await refused(()=>act("desktop set element text",{index:element("LockedField").i,text:"changed"}));
  await wait(200);
  record("setting a read-only field is reported as failed, not as done",Boolean(lockedResult&&/not set/.test(lockedResult))&&state().locked==="fixed",lockedResult);

  const unchanged=await act("desktop click element",{index:element("LockedField").i,pattern:false,window:title}).catch((error:Error)=>({error:error.message}));
  record("a click that changes nothing says so",unchanged.effect?.changed===false,unchanged.effect??unchanged);

  await act("desktop focus window",{title});
  const screenshot=await act("desktop screenshot",{maxWidth:800});
  record("screenshot of the real screen",screenshot.bytes>1000,screenshot.screen);
}catch(error){record("scenario completed",false,String((error as Error).stack??error).slice(0,600));}
finally{try{child.kill();}catch{}}

const report={at:new Date().toISOString(),ok:checks.length>=9&&checks.every(c=>c.ok),passed:checks.filter(c=>c.ok).length,total:checks.length,checks};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","desktop-effect-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({report:out,ok:report.ok,passed:report.passed,total:report.total}));
process.exit(report.ok?0:1);
