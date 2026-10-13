import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Small Windows helpers LayanX ships as C# source and compiles on the PC with the .NET Framework 4
 * compiler that is part of Windows 10 and 11 (no SDK, no download): the sandbox launcher, the hook relay
 * for coding agents, the screen-top island.
 */
export function cscPath(env:NodeJS.ProcessEnv=process.env):string|null{
  const win=env.WINDIR||env.SystemRoot||"C:\\Windows";
  for(const fw of ["Framework64","Framework"]){const p=path.join(win,"Microsoft.NET",fw,"v4.0.30319","csc.exe");if(fs.existsSync(p))return p;}
  return null;
}

function run(command:string,args:string[],timeout=120_000):Promise<{code:number|null;out:string}>{
  return new Promise(resolve=>execFile(command,args,{windowsHide:true,timeout,maxBuffer:4*1024*1024},(err,stdout,stderr)=>{
    resolve({code:err?(typeof (err as {code?:unknown}).code==="number"?(err as {code:number}).code:1):0,out:String(stdout)+String(stderr)});
  }));
}

export const sourceHash=(source:string)=>createHash("sha256").update(source).digest("hex").slice(0,12);

const compiling=new Map<string,Promise<string>>();
/**
 * Compiles `source` to `exe` unless that exe was already built from the same source (a .sha file next
 * to it says which). A fixed path survives updates, which matters when other programs (Claude Code's
 * settings) point at it; when the old exe is in use the new one waits for the next start.
 */
export function ensureCompiled(input:{source:string;exe:string;target?:"exe"|"winexe";refs?:string[];env?:NodeJS.ProcessEnv;what:string}):Promise<string>{
  const {exe}=input;
  const hash=sourceHash(input.source+(input.refs??[]).join(",")+(input.target??"exe"));
  const stamp=exe+".sha";
  const current=()=>{try{return fs.readFileSync(stamp,"utf8").trim()===hash&&fs.existsSync(exe);}catch{return false;}};
  if(current())return Promise.resolve(exe);
  const running=compiling.get(exe);
  if(running)return running;
  const job=(async()=>{
    if(process.platform!=="win32")throw new Error(`${input.what} runs on Windows only.`);
    const csc=cscPath(input.env);
    if(!csc)throw new Error(`${input.what} needs the .NET Framework 4 compiler (csc.exe), which is part of Windows 10 and 11.`);
    fs.mkdirSync(path.dirname(exe),{recursive:true});
    const src=exe.replace(/\.exe$/i,".cs"),tmp=exe+".tmp";
    // With a BOM csc reads the source as UTF-8 (the island has Arabic text), whatever the code page.
    fs.writeFileSync(src,"\uFEFF"+input.source);
    const r=await run(csc,["/nologo",`/target:${input.target??"exe"}`,"/optimize+",...(input.refs??[]).map(x=>"/r:"+x),"/out:"+tmp,src]);
    if(r.code!==0||!fs.existsSync(tmp))throw new Error(`Could not compile ${input.what}: `+r.out.slice(-800));
    try{fs.renameSync(tmp,exe);}catch(error){
      // The old one is running (a hook or the island): keep it, build again next time.
      fs.rmSync(tmp,{force:true});
      if(fs.existsSync(exe))return exe;
      throw error;
    }
    fs.writeFileSync(stamp,hash);
    return exe;
  })().finally(()=>compiling.delete(exe));
  compiling.set(exe,job);
  return job;
}
