import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";

/**
 * Pinned external tools. Every download is checked against the SHA-256 published with that exact
 * release before it is used: in March 2026 hijacked releases of Trivy (v0.69.4) and LiteLLM
 * (1.82.7/1.82.8) stole credentials from everyone who installed "latest". LayanX never installs
 * "latest" and never runs a file whose hash does not match.
 */
export interface PinnedTool{
  name:string;version:string;
  /** Windows x64 asset: URL, SHA-256, and either the exe inside a zip or a bare exe. */
  windows:{url:string;sha256:string;archive:"zip"|"exe";exe:string};
  homepage:string;license:string;
}
export const PINNED_TOOLS:PinnedTool[]=[
  {name:"gitleaks",version:"8.30.1",homepage:"https://github.com/gitleaks/gitleaks",license:"MIT",
    windows:{url:"https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip",sha256:"d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",archive:"zip",exe:"gitleaks.exe"}},
  {name:"osv-scanner",version:"2.6.0",homepage:"https://github.com/google/osv-scanner",license:"Apache-2.0",
    windows:{url:"https://github.com/google/osv-scanner/releases/download/v2.6.0/osv-scanner_windows_amd64.exe",sha256:"e0ed7644118b717b028c249ee9d3515024e55e8510747ca08906eb96765354d6",archive:"exe",exe:"osv-scanner.exe"}},
  {name:"opengrep",version:"1.30.1",homepage:"https://github.com/opengrep/opengrep",license:"LGPL-2.1 (run as a separate program)",
    windows:{url:"https://github.com/opengrep/opengrep/releases/download/v1.30.1/opengrep_windows_x86.exe",sha256:"d3a45326ff63cabe90d94ebc679fcd4302440178a0e5bf0248a6f7b610db3b53",archive:"exe",exe:"opengrep.exe"}}
];

export function toolsDir(env:NodeJS.ProcessEnv=process.env):string{
  if(env.LAYANX_TOOLS_DIR?.trim())return env.LAYANX_TOOLS_DIR.trim();
  const base=env.LAYANX_DATA_DIR?.trim()||(env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,"LayanX"):path.join(process.cwd(),".layanx"));
  return path.join(base,"tools","bin");
}

export function sha256File(file:string):string{
  const hash=createHash("sha256");const fd=fs.openSync(file,"r");const buf=Buffer.alloc(1<<20);
  try{let n:number;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)hash.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}
  return hash.digest("hex");
}
export function verifySha256(file:string,expected:string):void{
  const actual=sha256File(file);
  if(actual!==expected.toLowerCase())throw new Error(`SHA-256 mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}. The file was deleted; do not install it.`);
}

export interface LockEntry{name:string;version:string;sha256:string;exe:string;installedAt:string}
const lockFile=(dir:string)=>path.join(dir,"tools.lock.json");
export function readLock(dir:string=toolsDir()):LockEntry[]{try{return JSON.parse(fs.readFileSync(lockFile(dir),"utf8")) as LockEntry[];}catch{return[];}}

/** Installed and still matching the hash recorded at install time (a replaced binary is not used). */
export function installedTool(name:string,dir:string=toolsDir()):string|null{
  const entry=readLock(dir).find(e=>e.name===name);
  if(!entry)return null;
  const exe=path.join(dir,entry.exe);
  try{if(sha256File(exe)!==entry.sha256)return null;}catch{return null;}
  return exe;
}

/** Download, verify, unpack and record one pinned tool (Windows). */
export async function installPinnedTool(tool:PinnedTool,options:{dir?:string;fetcher?:typeof fetch;log?:(m:string)=>void}={}):Promise<LockEntry>{
  const dir=options.dir??toolsDir();const log=options.log??(()=>undefined);
  fs.mkdirSync(dir,{recursive:true});
  const asset=tool.windows;
  const download=path.join(dir,`.${tool.name}-${tool.version}.download`);
  log(`downloading ${tool.name} ${tool.version}`);
  const response=await (options.fetcher??fetch)(asset.url,{redirect:"follow",signal:AbortSignal.timeout(300_000)});
  if(!response.ok)throw new Error(`Download of ${tool.name} failed: HTTP ${response.status}`);
  fs.writeFileSync(download,Buffer.from(await response.arrayBuffer()));
  try{verifySha256(download,asset.sha256);}catch(error){fs.rmSync(download,{force:true});throw error;}
  log(`${tool.name}: SHA-256 verified`);
  const target=path.join(dir,asset.exe);
  if(asset.archive==="exe")fs.renameSync(download,target);
  else{
    const unpack=path.join(dir,`.${tool.name}-unpack`);fs.rmSync(unpack,{recursive:true,force:true});fs.mkdirSync(unpack,{recursive:true});
    // tar.exe ships with Windows 10+ and reads zip files; no PowerShell or extra library needed.
    const r=spawnSync(process.platform==="win32"?path.join(process.env.SystemRoot??"C:\\Windows","System32","tar.exe"):"tar",["-xf",download,"-C",unpack],{windowsHide:true,encoding:"utf8"});
    fs.rmSync(download,{force:true});
    if(r.status!==0)throw new Error(`Could not unpack ${tool.name}: ${r.stderr||r.error?.message}`);
    const found=path.join(unpack,asset.exe);
    if(!fs.existsSync(found))throw new Error(`${asset.exe} was not found inside the ${tool.name} archive.`);
    fs.copyFileSync(found,target);fs.rmSync(unpack,{recursive:true,force:true});
  }
  const entry:LockEntry={name:tool.name,version:tool.version,sha256:sha256File(target),exe:asset.exe,installedAt:new Date().toISOString()};
  const lock=readLock(dir).filter(e=>e.name!==tool.name);lock.push(entry);
  fs.writeFileSync(lockFile(dir),JSON.stringify(lock,null,1));
  return entry;
}
