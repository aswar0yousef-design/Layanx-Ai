import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
import {safeChildEnv} from "../platform/safe-env.js";
import {projectDir} from "./project-dir.js";
import {runOnce} from "./project-runner.js";
import {isolationLevel,restrictedAvailable} from "./sandbox.js";
import {denyGitAfterRun,prepareRestricted,restrictedCommand,restrictedEnv} from "../platform/windows-sandbox.js";

/**
 * agent.external: hand a coding task to a specialised coding agent running inside the project folder.
 *
 *   aider        local  - uses your Ollama coder model (pip install aider-chat)
 *   claude-code  cloud  - Anthropic's Claude Code CLI (npm i -g @anthropic-ai/claude-code); edits only, no shell
 *   codex        cloud  - OpenAI Codex CLI (npm i -g @openai/codex); extra flags via LAYANX_CODEX_ARGS
 *
 * The task text travels as one argv entry (never through a shell). LayanX re-runs tests and
 * build afterwards; the external agent's own "done" is never trusted on its own.
 * Cloud agents are only offered when the cloud policy allows it.
 */
export type ExternalAgentName="aider"|"claude-code"|"codex";
export interface ExternalAgent{name:ExternalAgentName;kind:"local"|"cloud";path:string;label:string}

function npmGlobalRoots():string[]{
  const roots=[
    process.env.APPDATA?path.join(process.env.APPDATA,"npm","node_modules"):"",
    path.join(path.dirname(process.execPath),"node_modules"),
    path.join(path.dirname(process.execPath),"..","lib","node_modules"),
    path.join(os.homedir(),".npm-global","lib","node_modules"),
    process.env.NPM_CONFIG_PREFIX?path.join(process.env.NPM_CONFIG_PREFIX,"lib","node_modules"):""
  ];
  return [...new Set(roots.filter(Boolean))];
}
function findNpmEntry(pkg:string,entry:string):string|null{
  for(const r of npmGlobalRoots()){const p=path.join(r,...pkg.split("/"),entry);if(fs.existsSync(p))return p;}
  return null;
}
function which(cmd:string):string|null{
  try{const out=execFileSync(process.platform==="win32"?"where":"which",[cmd],{encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","ignore"],timeout:3000});
    const lines=out.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    return lines.find(l=>!/\.(cmd|bat)$/i.test(l))??null;}catch{return null;}
}

let cache:{at:number;list:ExternalAgent[]}|null=null;
export function detectExternalAgents(force=false):ExternalAgent[]{
  if(!force&&cache&&Date.now()-cache.at<60_000)return cache.list;
  const list:ExternalAgent[]=[];
  const aider=process.env.LAYANX_AIDER_PATH||which("aider");
  if(aider)list.push({name:"aider",kind:"local",path:aider,label:"Aider (local, Ollama)"});
  const claude=process.env.LAYANX_CLAUDE_CODE_PATH||findNpmEntry("@anthropic-ai/claude-code","cli.js");
  if(claude)list.push({name:"claude-code",kind:"cloud",path:claude,label:"Claude Code (cloud)"});
  const codex=process.env.LAYANX_CODEX_PATH||findNpmEntry("@openai/codex","bin/codex.js");
  if(codex)list.push({name:"codex",kind:"cloud",path:codex,label:"OpenAI Codex (cloud)"});
  cache={at:Date.now(),list};
  return list;
}

export function cloudAgentsAllowed(env:NodeJS.ProcessEnv=process.env):boolean{return (env.LAYANX_CLOUD_POLICY??"fallback")!=="off";}

/** argv for one delegated task. Exported for tests. */
export function externalCommand(agent:ExternalAgent,task:string,env:NodeJS.ProcessEnv=process.env):{command:string;args:string[];label:string;extraEnv:Record<string,string>}{
  const text="Task: "+task.replace(/\0/g,"").slice(0,8000);
  const scriptRunner=(p:string)=>/\.(c|m)?js$/i.test(p)?{command:process.execPath,prefix:[p]}:{command:p,prefix:[]};
  if(agent.name==="aider"){
    const model=env.LAYANX_AIDER_MODEL||("ollama_chat/"+(env.LAYANX_CODER_MODEL||"qwen2.5-coder:7b"));
    return{command:agent.path,args:["--yes-always","--no-auto-commits","--no-check-update","--no-show-model-warnings","--no-stream","--no-pretty","--model",model,"--message",text],label:"aider",
      extraEnv:{OLLAMA_API_BASE:(env.OLLAMA_BASE_URL||"http://127.0.0.1:11434").replace(/\/+$/,"")}};
  }
  if(agent.name==="claude-code"){
    const r=scriptRunner(agent.path);
    return{command:r.command,args:[...r.prefix,"-p",text,"--permission-mode","acceptEdits","--output-format","text"],label:"claude-code",
      extraEnv:env.ANTHROPIC_API_KEY?{ANTHROPIC_API_KEY:env.ANTHROPIC_API_KEY}:{}};
  }
  const r=scriptRunner(agent.path);
  const extra=(env.LAYANX_CODEX_ARGS??"").split(/\s+/).filter(a=>/^--?[\w-]+(=[\w.:/-]+)?$/.test(a));
  return{command:r.command,args:[...r.prefix,"exec",...extra,text],label:"codex",extraEnv:env.OPENAI_API_KEY?{OPENAI_API_KEY:env.OPENAI_API_KEY}:{}};
}

export function pickExternalAgent(requested:string|undefined,env:NodeJS.ProcessEnv=process.env):ExternalAgent|null{
  const all=detectExternalAgents().filter(a=>a.kind==="local"||cloudAgentsAllowed(env));
  if(requested&&requested!=="auto")return all.find(a=>a.name===requested)??null;
  return all.find(a=>a.kind==="local")??all[0]??null;
}

/** An image reference with an exact tag (not "latest") or a digest. */
export function pinnedImage(image:string):boolean{
  return /^[\w./-]+(:[\w.-]+)?@sha256:[a-f0-9]{64}$/.test(image)||(/^[\w./-]+:[\w.-]+$/.test(image)&&!/:latest$/.test(image));
}
/**
 * Docker isolation: the coding agent runs inside a container that sees only the project folder.
 * The owner chooses a pinned image per agent (LAYANX_AGENT_IMAGE_AIDER / _CLAUDE_CODE / _CODEX) whose
 * entry point is the agent's CLI. Network stays on so the agent can reach Ollama on this PC
 * (host.docker.internal) or its cloud API; capabilities are dropped and memory/CPU/processes are limited.
 */
export function externalDockerCommand(agent:ExternalAgent,task:string,dir:string,env:NodeJS.ProcessEnv=process.env):{command:string;args:string[];label:string}{
  const key="LAYANX_AGENT_IMAGE_"+agent.name.toUpperCase().replace(/-/g,"_");
  const image=env[key]?.trim()??"";
  if(!image)throw new Error(`This project is isolated in Docker. Set ${key} to a pinned image of ${agent.label} (for example name:1.2.3), or lower the isolation level; LayanX will not run the agent outside the container.`);
  if(!pinnedImage(image))throw new Error(`${key} must name an exact version or digest, not "latest".`);
  // The image's entry point is the agent CLI, so the args carry no host path (path "agent" = no script prefix).
  const inner=externalCommand({...agent,path:"agent"},task,{...env,OLLAMA_BASE_URL:"http://host.docker.internal:11434"});
  const envArgs=Object.entries(inner.extraEnv).flatMap(([k,v])=>["-e",`${k}=${v}`]);
  return{command:"docker",label:"docker: "+inner.label,args:["run","--rm","--init",
    "--mount",`type=bind,source=${dir},target=/work`,"-w","/work",
    "--cap-drop","ALL","--security-opt","no-new-privileges","--pids-limit","512",
    "--memory",env.LAYANX_DOCKER_MEMORY&&/^\d+[mg]$/i.test(env.LAYANX_DOCKER_MEMORY)?env.LAYANX_DOCKER_MEMORY:"4g",
    "--cpus",env.LAYANX_DOCKER_CPUS&&/^\d+(\.\d+)?$/.test(env.LAYANX_DOCKER_CPUS)?env.LAYANX_DOCKER_CPUS:"2",
    "--add-host","host.docker.internal:host-gateway",
    "-e","HOME=/tmp","-e","CI=1","-e","NO_COLOR=1",...envArgs,
    image,...inner.args]};
}

export function createExternalAgentAdapter():ToolAdapter{
  return{async execute(request:ToolRequest){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const task=typeof input.task==="string"?input.task.trim():"";
    if(task.length<5)throw new Error("task is required.");
    const agent=pickExternalAgent(typeof input.agent==="string"?input.agent:undefined);
    if(!agent)throw new Error("No coding agent is installed (Aider, Claude Code or Codex), or cloud agents are switched off.");
    const dir=projectDir(request.projectId);
    const timeout=Number(process.env.LAYANX_EXTERNAL_AGENT_TIMEOUT_MS)||20*60_000;
    if(isolationLevel(request.projectId)==="docker"){
      // Never bypass the project's isolation: inside the container or not at all.
      const docker=externalDockerCommand(agent,task,dir);
      const result=await runOnce(docker,dir,timeout,safeChildEnv());
      return{agent:agent.name,kind:agent.kind,isolation:"docker",...result,ok:result.exitCode===0&&!result.timedOut};
    }
    const cmd=externalCommand(agent,task);
    const env=safeChildEnv({allow:["PYTHONPATH","VIRTUAL_ENV"],extra:{...cmd.extraEnv,NO_COLOR:"1",CI:"1"}});
    if(isolationLevel(request.projectId)==="restricted"){
      // Same rule as Docker: inside the restriction or not at all. The agent gets its own home folder
      // (its caches and settings), and can write nowhere else but the project.
      if(!restrictedAvailable())throw new Error("This project uses restricted isolation, which runs on Windows only. LayanX will not run the agent without it.");
      const setup=await prepareRestricted(dir);
      const result=await runOnce(restrictedCommand({command:cmd.command,args:cmd.args,label:cmd.label},dir,setup),dir,timeout,restrictedEnv(env,setup,{home:true}));
      await denyGitAfterRun(dir,setup);
      return{agent:agent.name,kind:agent.kind,isolation:"restricted",...result,ok:result.exitCode===0&&!result.timedOut};
    }
    const result=await runOnce({command:cmd.command,args:cmd.args,label:cmd.label},dir,timeout,env);
    return{agent:agent.name,kind:agent.kind,...result,ok:result.exitCode===0&&!result.timedOut};
  }};
}
