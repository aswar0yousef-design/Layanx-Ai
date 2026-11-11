import fs from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {NODE_REPAIR_PROFILE} from "./node-repair.js";
import type {Supervisor,SupervisorJob} from "./supervisor.js";

/**
 * LayanX changing its own code, the safe way round: on a separate branch in a separate folder, through the same repair
 * path as any project, then the full release gate. It stops at "waiting for the owner". Nothing here can merge.
 */
export interface SelfDevReport{id:string;goal:string;status:"awaiting_approval"|"failed"|"refused";branch:string;worktree:string;jobId?:string;changedFiles:string[];gate:{ok:boolean;summary:string}|null;reason?:string;mergeCommand?:string}

/** What guards LayanX is not something LayanX may weaken on its own, even when every test still passes. */
const PROTECTED=[/^scripts\/security-check/,/^scripts\/test-suite-runner/,/^package(-lock)?\.json$/,/^\.github\//,/^src\/core\/runtime\.ts$/,/^src\/core\/audit\.ts$/,/^src\/autonomy\/(?:trust|sandbox|self-development)\.ts$/,/^src\/config\/permissions/,/^tests\//];
export const protectedChanges=(files:string[])=>files.filter(file=>PROTECTED.some(rule=>rule.test(file.replace(/\\/g,"/"))));

const git=(cwd:string,...args:string[])=>{
  const run=spawnSync("git",["-c","user.name=LayanX","-c","user.email=layanx@local.invalid",...args],{cwd,encoding:"utf8",windowsHide:true,timeout:120_000});
  if(run.status!==0)throw new Error(`git ${args[0]}: ${(run.stderr||run.stdout||"").trim().slice(0,400)}`);
  return run.stdout;
};
/** Runs the project's release gate with no credentials in its environment. */
export function runReleaseGate(dir:string,timeoutMs=25*60_000):Promise<{ok:boolean;summary:string}>{
  const env:NodeJS.ProcessEnv={...process.env};
  // The gate must judge the code, not this machine's settings: a narrowed capability list alone makes unrelated pages fail.
  for(const key of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|^LAYANX_|^OLLAMA_MODEL|^MT5_|^BINANCE_|^OPENAI_|^ANTHROPIC_|^GEMINI_/i.test(key))delete env[key];
  return new Promise(resolve=>{
    let output="";
    const child=spawn("npm run release:check",{cwd:dir,env,shell:true,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const keep=(chunk:Buffer)=>{output=(output+chunk.toString("utf8")).slice(-4000);};
    child.stdout.on("data",keep);child.stderr.on("data",keep);
    const timer=setTimeout(()=>{if(process.platform==="win32")spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true});else child.kill("SIGKILL");},timeoutMs);
    child.on("close",code=>{clearTimeout(timer);resolve({ok:code===0,summary:output.trim().slice(-800)});});
  });
}
const DONE=new Set(["completed","failed","cancelled","budget_exhausted"]);
export async function runSelfDevelopment(input:{goal:string;repo:string;workspaceRoot:string;supervisor:Pick<Supervisor,"create">;gate?:typeof runReleaseGate;pollMs?:number;maxMinutes?:number;onProject?:(projectId:string)=>void}):Promise<SelfDevReport>{
  const id=randomBytes(4).toString("hex"),projectId="layanx-self-"+id,branch="layanx/self/"+id,worktree=path.join(input.workspaceRoot,projectId);
  fs.mkdirSync(input.workspaceRoot,{recursive:true});
  const head=git(input.repo,"rev-parse","HEAD").trim();
  git(input.repo,"worktree","add","-q","-b",branch,worktree,head);
  const modules=path.join(input.repo,"node_modules");
  if(fs.existsSync(modules))fs.symlinkSync(modules,path.join(worktree,"node_modules"),"junction");
  input.onProject?.(projectId);
  const report:SelfDevReport={id,goal:input.goal,status:"failed",branch,worktree,changedFiles:[],gate:null};
  const job:SupervisorJob=input.supervisor.create(input.goal,projectId,{acceptanceProfile:NODE_REPAIR_PROFILE,maxMinutes:input.maxMinutes??60,maxRounds:10,openWhenDone:false});
  report.jobId=job.id;
  while(!DONE.has(job.status))await new Promise(resolve=>setTimeout(resolve,input.pollMs??2000));
  const changed=()=>{
    // node_modules is a link and .layanx is the job's own notes; everything else counts, committed or not.
    // Added first and taken out after, because git refuses to exclude by name a path that is already ignored.
    git(worktree,"add","-A","--",".");
    git(worktree,"reset","-q","--","node_modules",".layanx");
    return git(worktree,"diff","--cached","--name-only",head).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  };
  report.changedFiles=changed();
  if(job.status!=="completed"){report.reason=`The repair did not finish (${job.status}): ${String(job.result??"").slice(0,400)}`;return report;}
  if(!report.changedFiles.length){report.reason="The repair changed nothing.";return report;}
  const touched=protectedChanges(report.changedFiles);
  if(touched.length){report.status="refused";report.reason="LayanX may not change its own guards on its own: "+touched.join(", ");return report;}
  git(worktree,"commit","-q","--allow-empty","-m","LayanX self-development: "+input.goal.split("\n")[0]!.slice(0,120));
  report.gate=await (input.gate??runReleaseGate)(worktree);
  if(!report.gate.ok){report.reason="The release gate failed.";return report;}
  report.status="awaiting_approval";
  report.mergeCommand=`git merge --no-ff ${branch}`;
  return report;
}
