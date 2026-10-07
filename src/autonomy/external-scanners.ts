import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn,execFileSync} from "node:child_process";
import {installedTool,toolsDir} from "../platform/tool-installer.js";
import {safeChildEnv} from "../platform/safe-env.js";
import type {SecurityFinding,Severity} from "./security-scan.js";

/**
 * Optional external scanners, used when installed (scripts/windows/install-security-tools.ps1 installs
 * pinned, hash-verified copies into the LayanX tools folder; copies on PATH are used too):
 *   gitleaks     secrets in files (MIT)
 *   osv-scanner  vulnerable dependencies for npm, PyPI, Dart/pub, NuGet, Go... (Apache-2.0)
 *   opengrep     code patterns (LGPL-2.1, separate program) with LayanX's own rules (config/opengrep-rules.yml)
 * Each one is skipped cleanly when absent; none of them gets LayanX's secrets in its environment.
 */
export interface ScannerResult{tool:string;ran:boolean;note?:string;findings:SecurityFinding[]}
const RULES_FILE=fileURLToPath(new URL("../../config/opengrep-rules.yml",import.meta.url));

function onPath(exe:string):string|null{
  try{const out=execFileSync(process.platform==="win32"?"where":"which",[exe],{encoding:"utf8",stdio:["ignore","pipe","ignore"],windowsHide:true});return out.split(/\r?\n/).find(Boolean)??null;}catch{return null;}
}
export function findScanner(name:string,env:NodeJS.ProcessEnv=process.env):string|null{
  const pinned=installedTool(name,toolsDir(env));if(pinned)return pinned;
  if(env.LAYANX_SCANNERS_FROM_PATH==="off")return null;
  return onPath(process.platform==="win32"?name+".exe":name);
}

function run(command:string,args:string[],cwd:string,timeoutMs:number):Promise<{code:number|null;stdout:string;stderr:string;timedOut:boolean}>{
  return new Promise(resolve=>{
    const child=spawn(command,args,{cwd,shell:false,windowsHide:true,env:safeChildEnv()});
    let stdout="",stderr="",timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
    child.stdout.setEncoding("utf8").on("data",(c:string)=>{if(stdout.length<20_000_000)stdout+=c;});
    child.stderr.setEncoding("utf8").on("data",(c:string)=>{stderr=(stderr+c).slice(-8000);});
    child.on("error",e=>{clearTimeout(timer);resolve({code:null,stdout,stderr:String(e),timedOut});});
    child.on("close",code=>{clearTimeout(timer);resolve({code,stdout,stderr,timedOut});});
  });
}
const rel=(dir:string,file:unknown)=>{const f=String(file??"");return path.isAbsolute(f)?path.relative(dir,f).replace(/\\/g,"/"):f.replace(/\\/g,"/");};

export async function runGitleaks(dir:string,exe:string):Promise<ScannerResult>{
  const report=path.join(os.tmpdir(),`layanx-gitleaks-${process.pid}-${Date.now()}.json`);
  try{
    const r=await run(exe,["dir",dir,"--report-format","json","--report-path",report,"--no-banner","--redact","--exit-code","0","--log-level","error"],dir,180_000);
    if(r.timedOut)return{tool:"gitleaks",ran:false,note:"timed out",findings:[]};
    if(!fs.existsSync(report))return{tool:"gitleaks",ran:false,note:"no report: "+r.stderr.slice(0,200),findings:[]};
    const items=JSON.parse(fs.readFileSync(report,"utf8")||"[]") as Array<Record<string,unknown>>;
    return{tool:"gitleaks",ran:true,findings:items.filter(i=>!/(^|\/)(node_modules|\.git|dist|build)\//.test(rel(dir,i.File))).slice(0,100).map(i=>({severity:"critical" as Severity,rule:"gitleaks."+String(i.RuleID??"secret"),message:`Secret in file (${String(i.Description??i.RuleID??"secret")})`,file:rel(dir,i.File),line:Number(i.StartLine)||undefined,fix:"Remove it from the code, rotate the key, and read it from the environment / LayanX secrets."}))};
  }catch(error){return{tool:"gitleaks",ran:false,note:error instanceof Error?error.message:String(error),findings:[]};}
  finally{fs.rmSync(report,{force:true});}
}

const cvssSeverity=(score:number):Severity=>score>=9?"critical":score>=7?"high":score>=4?"medium":"low";
export function parseOsv(stdout:string):SecurityFinding[]{
  const data=JSON.parse(stdout) as {results?:Array<{source?:{path?:string};packages?:Array<{package?:{name?:string;version?:string;ecosystem?:string};groups?:Array<{ids?:string[];max_severity?:string}>;vulnerabilities?:Array<{id?:string;summary?:string}>}>}>};
  const out:SecurityFinding[]=[];
  for(const result of data.results??[])for(const pkg of result.packages??[]){
    const name=pkg.package?.name??"?";const groups=pkg.groups?.length?pkg.groups:(pkg.vulnerabilities??[]).map(v=>({ids:[v.id??"?"],max_severity:""}));
    for(const g of groups){
      const score=Number(g.max_severity);const severity:Severity=Number.isFinite(score)&&score>0?cvssSeverity(score):"medium";
      const summary=(pkg.vulnerabilities??[]).find(v=>g.ids?.includes(v.id??""))?.summary;
      out.push({severity,rule:"deps.vulnerable",message:`Vulnerable dependency: ${name} ${pkg.package?.version??""} (${pkg.package?.ecosystem??""}) ${g.ids?.slice(0,2).join(", ")??""}${summary?" - "+summary.slice(0,120):""}`.trim(),file:result.source?.path,fix:"Update the package to a fixed version (osv.dev lists it)."});
    }
  }
  return out;
}
export async function runOsvScanner(dir:string,exe:string):Promise<ScannerResult>{
  const r=await run(exe,["scan","source","-r",dir,"--format","json"],dir,300_000);
  if(r.timedOut)return{tool:"osv-scanner",ran:false,note:"timed out",findings:[]};
  if(r.code===128)return{tool:"osv-scanner",ran:true,note:"no package manifests found",findings:[]};
  try{return{tool:"osv-scanner",ran:true,findings:parseOsv(r.stdout).slice(0,150)};}
  catch{return{tool:"osv-scanner",ran:false,note:"could not read its report: "+r.stderr.slice(0,200),findings:[]};}
}

export function parseOpengrep(stdout:string,dir:string):SecurityFinding[]{
  const data=JSON.parse(stdout) as {results?:Array<{check_id?:string;path?:string;start?:{line?:number};extra?:{message?:string;severity?:string}}>};
  const sev=(s?:string):Severity=>s==="ERROR"?"high":s==="WARNING"?"medium":"low";
  return (data.results??[]).map(r=>({severity:sev(r.extra?.severity),rule:String(r.check_id??"opengrep").replace(/^.*?layanx\./,"layanx."),message:String(r.extra?.message??"Opengrep finding").slice(0,300),file:rel(dir,r.path),line:r.start?.line,fix:String(r.extra?.message??"See the rule.").slice(0,300)}));
}
export async function runOpengrep(dir:string,exe:string,env:NodeJS.ProcessEnv=process.env):Promise<ScannerResult>{
  const config=env.LAYANX_OPENGREP_CONFIG?.trim()||RULES_FILE;
  // Scan "." from inside the project: relative targets behave the same on Windows and POSIX.
  const r=await run(exe,["scan","--config",config,"--json","--quiet","--exclude","node_modules","--exclude",".layanx","."],dir,300_000);
  if(r.timedOut)return{tool:"opengrep",ran:false,note:"timed out",findings:[]};
  try{
    const data=JSON.parse(r.stdout) as {errors?:Array<{message?:string;type?:unknown}>;paths?:{scanned?:unknown[]}};
    const errors=(data.errors??[]).map(e=>String(e.message??e.type??"error")).filter(Boolean);
    const scanned=Array.isArray(data.paths?.scanned)?data.paths!.scanned!.length:undefined;
    const note=[scanned!==undefined?`${scanned} files scanned`:"",errors.length?`${errors.length} error(s): ${errors[0]!.slice(0,300)}`:""].filter(Boolean).join("; ");
    return{tool:"opengrep",ran:true,...(note?{note}:{}),findings:parseOpengrep(r.stdout,dir).slice(0,150)};
  }
  catch{return{tool:"opengrep",ran:false,note:"could not read its report (exit "+r.code+"): "+(r.stderr||r.stdout).slice(0,300),findings:[]};}
}

export async function runExternalScanners(dir:string,env:NodeJS.ProcessEnv=process.env):Promise<ScannerResult[]>{
  if(env.LAYANX_EXTERNAL_SCANNERS==="off")return[];
  const jobs:Array<Promise<ScannerResult>>=[];
  const gl=findScanner("gitleaks",env);jobs.push(gl?runGitleaks(dir,gl):Promise.resolve({tool:"gitleaks",ran:false,note:"not installed",findings:[]}));
  const osv=findScanner("osv-scanner",env);jobs.push(osv?runOsvScanner(dir,osv):Promise.resolve({tool:"osv-scanner",ran:false,note:"not installed",findings:[]}));
  const og=findScanner("opengrep",env);jobs.push(og?runOpengrep(dir,og,env):Promise.resolve({tool:"opengrep",ran:false,note:"not installed",findings:[]}));
  return Promise.all(jobs);
}
