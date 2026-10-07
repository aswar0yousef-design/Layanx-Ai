import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {LAUNCHER_CS,launcherPath,quoteWindowsArg,restrictedCommand,restrictedEnv,sandboxMemoryBytes,windowsCommandLine} from "../src/platform/windows-sandbox.js";
import {ISOLATION_LEVELS,restrictedAvailable,setIsolation} from "../src/autonomy/sandbox.js";
import {createProjectRunnerAdapter} from "../src/autonomy/project-runner.js";

const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-wsb-"));
process.env.LAYANX_STORE_DIR=store;

// 1. Command lines survive the trip through CommandLineToArgvW (the parser every Windows program uses).
function parseArgv(line:string):string[]{
  const out:string[]=[];let i=0;
  while(i<line.length){
    while(line[i]===" "||line[i]==="\t")i++;
    if(i>=line.length)break;
    let arg="",quoted=false;
    for(;i<line.length;i++){
      const c=line[i]!;
      if(c==="\\"){let n=0;while(line[i]==="\\"){n++;i++;}
        if(line[i]==='"'){arg+="\\".repeat(Math.floor(n/2));if(n%2===1){arg+='"';continue;}i--;continue;}
        arg+="\\".repeat(n);i--;continue;}
      if(c==='"'){if(quoted&&line[i+1]==='"'){arg+='"';i++;continue;}quoted=!quoted;continue;}
      if(!quoted&&(c===" "||c==="\t"))break;
      arg+=c;
    }
    out.push(arg);
  }
  return out;
}
const samples=["","plain","with space","C:\\Program Files\\nodejs\\node.exe","ends\\","ends with space\\","quote\"inside","\\\"mixed\\\\\"","Task: fix the bug; rm -rf / && echo \"pwned\"","عربي مع مسافة","tab\there"];
for(const s of samples)assert.deepEqual(parseArgv(quoteWindowsArg(s)),[s],JSON.stringify(s));
const argv=["C:\\Program Files\\nodejs\\node.exe","C:\\x\\npm-cli.js","run","build","--","--flag=\"a b\""];
assert.deepEqual(parseArgv(windowsCommandLine(argv[0]!,argv.slice(1))),argv);

// 2. Memory limit follows the Docker setting; bad values fall back to 4 GB.
assert.equal(sandboxMemoryBytes({}),4*1024**3);
assert.equal(sandboxMemoryBytes({LAYANX_DOCKER_MEMORY:"512m"}),512*1024**2);
assert.equal(sandboxMemoryBytes({LAYANX_DOCKER_MEMORY:"6g"}),6*1024**3);
assert.equal(sandboxMemoryBytes({LAYANX_DOCKER_MEMORY:"6g; calc"}),4*1024**3);

// 3. The launcher is cached under a name derived from its source.
assert.match(launcherPath(),/lx-sandbox-[0-9a-f]{12}\.exe$/);

// 4. The launcher argv: the command line travels as base64 (no second round of quoting), .git is denied.
const setup={launcher:"C:\\data\\bin\\lx-sandbox.exe",tmp:"C:\\data\\sandbox\\tmp",cache:"C:\\data\\sandbox\\cache",home:"C:\\data\\sandbox\\home"};
const wrapped=restrictedCommand({command:"C:\\Program Files\\nodejs\\node.exe",args:["npm-cli.js","test"],label:"npm test"},"C:\\proj\\shop",setup,{LAYANX_DOCKER_MEMORY:"1g"});
const opt=(n:string)=>wrapped.args[wrapped.args.indexOf(n)+1];
assert.equal(wrapped.command,setup.launcher);assert.equal(wrapped.args[0],"run");
assert.equal(opt("--mem"),String(1024**3));assert.equal(opt("--procs"),"256");assert.equal(opt("--cwd"),"C:\\proj\\shop");
assert.equal(Buffer.from(opt("--cmdline")!,"base64").toString("utf8"),'"C:\\Program Files\\nodejs\\node.exe" npm-cli.js test');
assert.match(wrapped.label,/^restricted: npm test$/);
assert.throws(()=>restrictedCommand({command:"surely-not-a-program-xyz",args:[],label:"x"},"C:\\p",setup,{PATH:""}),/not found on PATH/);
// Caches and temp files go to the sandbox folders; the agent mode also moves the home folder.
const env=restrictedEnv({PATH:"x",USERPROFILE:"C:\\Users\\me"},setup);
assert.deepEqual([env.TEMP,env.TMP,env.USERPROFILE],[setup.tmp,setup.tmp,"C:\\Users\\me"]);
assert.ok(env.npm_config_cache!.startsWith(setup.cache));
assert.equal(restrictedEnv({},setup,{home:true}).USERPROFILE,setup.home);

// 5. The C# source compiles with the C# 5 compiler that ships with Windows: no newer syntax.
for(const bad of ['$"',"?.","nameof(","out var ","is var ","=> {"])assert.ok(!LAUNCHER_CS.includes(bad),"C# 6+ syntax in launcher: "+bad);
for(const api of ["CreateRestrictedToken","DISABLE_MAX_PRIVILEGE","TokenIntegrityLevel","S-1-16-4096","TokenOwner","KILL_ON_JOB_CLOSE","AssignProcessToJobObject","CREATE_SUSPENDED","TokenDefaultDacl","S-1-5-32-544"])assert.ok(LAUNCHER_CS.includes(api),api);

// 6. Isolation level wiring: available on Windows only, and the runner refuses elsewhere instead of running unprotected.
assert.ok(ISOLATION_LEVELS.includes("restricted"));
assert.equal(restrictedAvailable("win32"),true);assert.equal(restrictedAvailable("linux"),false);
if(process.platform!=="win32"){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-wsb-ws-"));process.env.LAYANX_WORKSPACE_ROOT=root;
  const iso=path.join(store,"isolation.json");process.env.LAYANX_ISOLATION_FILE=iso;
  fs.mkdirSync(path.join(root,"shop"));fs.writeFileSync(path.join(root,"shop","package.json"),JSON.stringify({name:"shop",scripts:{test:"node -e 1"}}));
  setIsolation(iso,"shop","restricted");
  const runner=createProjectRunnerAdapter();
  const req=(task:string)=>({missionId:"m",agentId:"core",projectId:"shop",tool:"project.run",action:"run project task",permission:"L4_EXECUTE",idempotencyKey:"k",payload:{task}} as any);
  await assert.rejects(runner.execute(req("test")) as Promise<unknown>,/Windows only/);
  assert.equal((await runner.execute(req("detect")) as any).isolation,"restricted");
  fs.rmSync(root,{recursive:true,force:true});
}
fs.rmSync(store,{recursive:true,force:true});
console.log("windows-sandbox: command-line quoting, launcher argv, memory limit, low-integrity C# 5 source and Windows-only wiring verified");
process.exit(0);
