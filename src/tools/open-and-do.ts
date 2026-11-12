import {openRequest} from "./open-app.js";

/**
 * "Open Notepad and write this line exactly: ..." / "open Calculator and compute 125 × 8". Seen live 2026-11-13 with MetaTrader
 * closed: the small local model planned web.form, store.report and files.write for these and never typed anything (0/4).
 * The wording is regular enough for code: open the program, then type into ITS window only (the typing step names the window
 * and waits for it to be in front, and nothing is sent to any other window), then read what the window shows.
 */
export interface OpenAndDo{app:string;label:string;window:string;keys:string;kind:"write"|"calculate";text?:string;expected?:number}
// Calculator's window title is exactly its name ("=" = the whole title), so a browser tab titled "حاسبة الخصم" never matches.
const WINDOWS:Record<string,string>={Notepad:"Notepad|المفكرة|مفكرة",Calculator:"=Calculator|=الحاسبة"};
const arabicDigits=(t:string)=>t.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

/** "125 × 8", "1500 ÷ 3 + 20": digits and + − × ÷ only, evaluated left to right with × ÷ first. */
export function arithmetic(text:string):{keys:string;value:number}|null{
  const t=arabicDigits(text).replace(/[×xX]/g,"*").replace(/[÷]/g,"/").replace(/[−–]/g,"-").replace(/،/g,",").replace(/(\d),(\d{3})/g,"$1$2").replace(/\s+/g,"");
  const m=/^(\d+(?:\.\d+)?(?:[-+*/]\d+(?:\.\d+)?)+)/.exec(t);if(!m)return null;
  const tokens=m[1]!.match(/\d+(?:\.\d+)?|[-+*/]/g)!;
  const terms:number[]=[];const ops:string[]=[];
  let cur=Number(tokens[0]);
  for(let i=1;i<tokens.length;i+=2){const op=tokens[i]!,n=Number(tokens[i+1]);
    if(op==="*")cur*=n;else if(op==="/"){if(n===0)return null;cur/=n;}else{terms.push(cur);ops.push(op);cur=op==="-"?n:n;}}
  terms.push(cur);
  let value=terms[0]!;for(let i=0;i<ops.length;i++)value=ops[i]==="+"?value+terms[i+1]!:value-terms[i+1]!;
  return{keys:m[1]!+"=",value:Math.round(value*1e9)/1e9};
}

export function openAndDoRequest(goal:string):OpenAndDo|null{
  const g=goal.trim();
  if(g.length>400||g.includes("\n"))return null;
  const m=/^(?:من فضلك\s+|لو سمحت\s+)?((?:افتح|شغّل|شغل|open|launch)\s+\S+(?:\s+\S+)?)\s+(?:و|ثم\s+|and\s+|then\s+)\s*(.+)$/iu.exec(g)
    ??/^((?:افتح|شغّل|شغل|open|launch)\s+\S+)\s*(?:و|and)\s*(.+)$/iu.exec(g);
  if(!m)return null;
  const opened=openRequest(m[1]!);
  if(!opened?.app||opened.url)return null;
  const label=opened.label,window=WINDOWS[label];
  if(!window)return null;
  const rest=m[2]!.trim();
  if(label==="Calculator"){
    const c=/^(?:احسب|احسبي|حاسب|calculate|compute|work out)\s*(?:لي|ناتج|me)?\s*(.+)$/iu.exec(rest);
    const sum=c?arithmetic(c[1]!):null;
    return sum?{app:opened.app,label,window,keys:sum.keys,kind:"calculate",expected:sum.value}:null;
  }
  const w=/^(?:اكتب|أكتب|write|type)\s*(?:فيها|فيه|بها|in it|into it)?\s*(.*)$/iu.exec(rest);
  if(!w)return null;
  // "this line exactly: X" / "the following: X" -> X; otherwise everything after the verb, without wrapping quotes.
  let text=w[1]!.trim();
  const colon=text.search(/[:：]/);
  if(colon>=0&&colon<40)text=text.slice(colon+1).trim();
  text=text.replace(/^["«“']+|["»”']+$/g,"").trim();
  if(!text||text.length>2000)return null;
  return{app:opened.app,label,window,keys:text,kind:"write",text};
}

/** What the Calculator shows, from its window's elements ("Display is 1,000" / «العرض هو ١٬٠٠٠»). */
export function calculatorDisplay(tree:unknown):number|null{
  const text=JSON.stringify(tree??"");
  const m=/(?:Display is|العرض هو|يتم عرض)\s*([-\d٠-٩.,٬\s]+)/u.exec(text);
  if(!m)return null;
  const n=Number(arabicDigits(m[1]!).replace(/[,٬\s]/g,""));
  return Number.isFinite(n)?n:null;
}

// ------------------------------------------------------------------------------------------------- Notepad, safely
import fs from "node:fs";
import path from "node:path";
import {spawn,execFileSync} from "node:child_process";
import type {LayanXCore} from "../core/orchestrator.js";
import {resolveDataPaths} from "../platform/paths.js";

/**
 * "Open Notepad and write X". Seen live 2026-11-13: opening Notepad restored the owner's own tabs and the front one was a
 * trading EA's source file, so typing would have gone into it. Nothing is typed: the text goes into a NEW file in LayanX's
 * own notes folder, Notepad opens that file, and the front Notepad window must show that file's name.
 */
export async function writeInNotepad(text:string,dir=path.join(resolveDataPaths().dataDir,"notes"),now=new Date()):Promise<{file:string;shown:boolean;title:string}>{
  if(process.platform!=="win32")throw new Error("Notepad is on Windows only.");
  if(!text.trim()||text.length>20_000)throw new Error("Nothing to write, or the text is too long.");
  fs.mkdirSync(dir,{recursive:true});
  const stamp=now.toISOString().replace(/[-:]/g,"").replace("T","-").slice(0,15);
  const file=path.join(dir,`LayanX-${stamp}.txt`);
  fs.writeFileSync(file,"﻿"+text,"utf8");
  spawn("notepad.exe",[file],{detached:true,stdio:"ignore",windowsHide:false}).unref();
  const name=path.basename(file,".txt");
  let title="";
  for(let i=0;i<20;i++){
    await new Promise(r=>setTimeout(r,400));
    try{title=execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command","[Console]::OutputEncoding=[Text.Encoding]::UTF8;(Get-Process notepad -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowTitle}|ForEach-Object{$_.MainWindowTitle}) -join \"`n\""],{encoding:"utf8",windowsHide:true,timeout:10_000});}catch{title="";}
    if(title.includes(name))break;
  }
  const shown=title.includes(name);
  return{file,shown,title:title.split("\n").find(t=>t.includes(name))??""};
}
export function registerNotepadTool(core:LayanXCore):void{
  core.tools.register({name:"desktop.notepad.write",description:"open Notepad with the owner's text (payload.text) in a new file of its own; never types into other Notepad tabs",
    permission:"L4_EXECUTE",dangerous:true,actions:["desktop notepad write"],tags:["desktop","notepad","المفكرة","write","اكتب"]});
  core.toolAdapters.register("desktop.notepad.write",{async execute(request){
    const p=request.payload&&typeof request.payload==="object"?request.payload as Record<string,unknown>:{};
    const result=await writeInNotepad(String(p.text??""));
    // The file holds exactly the text; the window must show that file, or it did not happen.
    if(!result.shown)throw new Error("Notepad did not show the new file "+path.basename(result.file)+".");
    return{...result,text:fs.readFileSync(result.file,"utf8").replace(/^﻿/,"")};
  }});
}
