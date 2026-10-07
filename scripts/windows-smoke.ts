/**
 * Real-Windows smoke test (run by scripts/windows/smoke-test.ps1 and the windows CI job).
 * Exercises what can only be proven on Windows: the compiled desktop helper (SendInput +
 * UI Automation), DPAPI secrets, spawning npm without .cmd, and Windows path guards.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/windows-smoke.ts [--no-ui]
 */
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createDesktopControlToolAdapter} from "../src/tools/desktop-control.js";
import {openSecretStore} from "../src/security/secret-store.js";
import {writeFileSync} from "node:fs";
import {commandFor,detectProject,runOnce} from "../src/autonomy/project-runner.js";

if(process.platform!=="win32"){console.log("windows-smoke: skipped (not Windows)");process.exit(0);}
const noUi=process.argv.includes("--no-ui");
const withTools=process.argv.includes("--with-tools");
const withVoice=process.argv.includes("--with-voice");
const results:Array<{check:string;ok:boolean;detail?:string}>=[];
async function check(name:string,fn:()=>Promise<string|void>){
  // On GitHub Actions each result also becomes an annotation, readable without downloading logs.
  const annotate=(level:"notice"|"error",text:string)=>{if(process.env.GITHUB_ACTIONS==="true")console.log(`::${level} title=Windows smoke::${text.replace(/\r?\n/g," ").slice(0,900)}`);};
  try{const detail=await fn();results.push({check:name,ok:true,...(detail?{detail}:{})});console.log("PASS",name,detail??"");annotate("notice","PASS "+name+(detail?" - "+detail:""));}
  catch(e){const detail=e instanceof Error?e.message:String(e);results.push({check:name,ok:false,detail});console.log("FAIL",name,detail);annotate("error","FAIL "+name+" - "+detail);}
}
const req=(action:string,payload:Record<string,unknown>={})=>({missionId:"smoke",agentId:"core",projectId:"smoke",tool:"desktop",action,permission:"L4_EXECUTE",idempotencyKey:"smoke-"+action,payload} as any);
const desktop=createDesktopControlToolAdapter();

await check("desktop helper compiles and reports Windows features",async()=>{
  const status=await desktop.execute(req("desktop status")) as any;
  assert.equal(status.ready,true,"powershell.exe found");
  assert.ok(status.features.includes("ui-automation-tree"));
  return status.features.join(",");
});
await check("UI Automation lists open windows",async()=>{
  const out=await desktop.execute(req("desktop ui tree",{scope:"windows"})) as any;
  assert.ok(Array.isArray(out.windows),"windows array");
  return out.windows.length+" windows";
});
await check("screenshot is a JPEG",async()=>{
  const shot=await desktop.execute(req("desktop screenshot",{maxWidth:800})) as any;
  assert.equal(shot.mimeType,"image/jpeg");assert.ok(shot.bytes>1000);
  return shot.screen+" "+shot.bytes+" bytes";
});
if(!noUi){
  await check("Notepad: focus, read elements, set Arabic text, read it back",async()=>{
    const notepad=spawn("notepad.exe",[],{detached:true,stdio:"ignore"});notepad.unref();
    try{
      let focused:any;
      for(let i=0;i<20&&!focused;i++){await new Promise(r=>setTimeout(r,500));focused=await desktop.execute(req("desktop focus window",{title:"Notepad"})).catch(()=>undefined);}
      assert.ok(focused,"Notepad window could be focused");
      await new Promise(r=>setTimeout(r,500));
      const tree=await desktop.execute(req("desktop ui tree")) as any;
      const editor=tree.elements.find((e:any)=>e.type==="Edit"||e.type==="Document");
      assert.ok(editor,"Notepad exposes its text area: "+JSON.stringify(tree).slice(0,300));
      const text="مرحبا LayanX 123";
      await desktop.execute(req("desktop set element text",{index:editor.i,text}));
      await new Promise(r=>setTimeout(r,300));
      const after=await desktop.execute(req("desktop ui tree")) as any;
      const again=after.elements.find((e:any)=>e.type===editor.type);
      return "elements="+tree.elements.length+" value="+(again?.value??"(not exposed)");
    }finally{spawnSync("taskkill",["/IM","notepad.exe","/F"],{stdio:"ignore"});}
  });
}
await check("PowerShell reads redirected stdin (diagnostic)",async()=>{
  const ps=(extra:string[])=>new Promise<string>(resolve=>{
    const script="$l=[Console]::In.ReadLine();[Console]::Out.Write('got:'+$l)";
    const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",...extra,"-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let out="";const t=setTimeout(()=>{child.kill();resolve("timeout");},20000);
    child.stdout.on("data",d=>out+=d);child.on("close",()=>{clearTimeout(t);resolve(out.trim()||"empty");});
    child.stdin.end("hello\n");
  });
  const plain=await ps([]);const none=await ps(["-InputFormat","None"]);
  assert.equal(none,"got:hello","-InputFormat None must let the script read stdin");
  return "default="+plain+" inputformat-none="+none;
});
await check("DPAPI secret store round trip",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"lx-smoke-"));
  try{
    const store=await openSecretStore(dir);
    assert.equal(store.backend,"dpapi");
    await store.set("SMOKE_TEST_KEY","سر-123");
    const reopened=await openSecretStore(dir);
    assert.equal(reopened.get("SMOKE_TEST_KEY"),"سر-123");
    return store.location;
  }finally{rmSync(dir,{recursive:true,force:true});}
});
await check("project scripts run through npm-cli.js (no .cmd spawning)",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"lx-smoke-npm-"));
  try{
    writeFileSync(join(dir,"package.json"),JSON.stringify({name:"smoke",version:"1.0.0",scripts:{test:"node -e \"console.log('smoke-ok')\""}}));
    const info=detectProject(dir);
    const r=await runOnce(commandFor(info,"test"),dir,60_000);
    assert.equal(r.exitCode,0,JSON.stringify(r).slice(0,400));
    assert.match(JSON.stringify(r),/smoke-ok/);
    return r.command;
  }finally{rmSync(dir,{recursive:true,force:true});}
});
if(withTools){
  await check("pinned security scanners find planted problems",async()=>{
    const {runExternalScanners,findScanner}=await import("../src/autonomy/external-scanners.js");
    for(const t of ["gitleaks","osv-scanner","opengrep"])assert.ok(findScanner(t),t+" is installed and hash-verified");
    const dir=mkdtempSync(join(tmpdir(),"lx-scan-"));
    try{
      const token="ghp_"+Array.from({length:36},(_,i)=>"aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5"[i]).join("");
      writeFileSync(join(dir,"config.js"),"export const githubToken = '"+token+"';\n");
      writeFileSync(join(dir,"run.js"),"const cp = require('child_process');\nfunction go(userInput){ eval(userInput); cp.exec('ls ' + userInput); }\nmodule.exports = go;\n");
      writeFileSync(join(dir,"package.json"),JSON.stringify({name:"scan-me",version:"1.0.0",dependencies:{lodash:"4.17.15"}}));
      writeFileSync(join(dir,"package-lock.json"),JSON.stringify({name:"scan-me",version:"1.0.0",lockfileVersion:3,requires:true,packages:{"":{name:"scan-me",version:"1.0.0",dependencies:{lodash:"4.17.15"}},"node_modules/lodash":{version:"4.17.15",resolved:"https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz"}}}));
      const results=await runExternalScanners(dir);
      const by=Object.fromEntries(results.map(r=>[r.tool,r]));
      assert.ok(by.gitleaks?.ran&&by.gitleaks.findings.length>0,"gitleaks: "+JSON.stringify(by.gitleaks).slice(0,300));
      assert.ok(by["osv-scanner"]?.ran&&by["osv-scanner"].findings.some(f=>/lodash/.test(f.message)),"osv-scanner: "+JSON.stringify(by["osv-scanner"]).slice(0,300));
      assert.ok(by.opengrep?.ran&&by.opengrep.findings.some(f=>f.rule==="layanx.js.eval"),"opengrep: "+JSON.stringify(by.opengrep).slice(0,400));
      return results.map(r=>r.tool+"="+r.findings.length).join(" ");
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
if(withVoice){
  await check("Piper speaks Arabic and Whisper hears it back (local voice round trip)",async()=>{
    const {LocalSpeaker,LocalTranscriber}=await import("../src/voice/service.js");
    const {existsSync,readdirSync,statSync}=await import("node:fs");
    const dataDir=process.env.LAYANX_DATA_DIR??join(process.env.LOCALAPPDATA??"",`LayanX`);
    const vpy=join(dataDir,"piper","venv","Scripts","python.exe"),voices=join(dataDir,"piper","voices");
    assert.ok(existsSync(vpy),"Piper installed by install-piper.ps1");
    const find=(dir:string,name:RegExp):string|undefined=>{for(const e of readdirSync(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isDirectory()){const r=find(f,name);if(r)return r;}else if(name.test(e.name))return f;}return undefined;};
    const whisperDir=join(dataDir,"whisper");
    const server=existsSync(whisperDir)?find(whisperDir,/^whisper-server\.exe$/i):undefined;
    const model=existsSync(join(whisperDir,"models"))?readdirSync(join(whisperDir,"models")).filter(f=>/^ggml-.*\.bin$/.test(f)).map(f=>join(whisperDir,"models",f)).sort((a,b)=>statSync(b).size-statSync(a).size)[0]:undefined;
    assert.ok(server&&model,"Whisper installed by install-whisper.ps1");
    const piper=spawn(vpy,["-m","piper.http_server","-m","ar_JO-kareem-medium","--data-dir",voices,"--host","127.0.0.1","--port","18179"],{cwd:voices,windowsHide:true,stdio:"ignore"});
    const whisper=spawn(server!,["-m",model!,"--host","127.0.0.1","--port","18178","--inference-path","/v1/audio/transcriptions","-t","2"],{windowsHide:true,stdio:"ignore"});
    const up=async(url:string)=>{for(let i=0;i<120;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw new Error("not reachable: "+url);};
    try{
      await up("http://127.0.0.1:18179/voices");await up("http://127.0.0.1:18178/");
      const spoken=await new LocalSpeaker("http://127.0.0.1:18179").speak("مرحبا، أنا ليان، مساعدك على هذا الحاسوب.","ar");
      assert.equal(spoken.audio.subarray(0,4).toString("ascii"),"RIFF");assert.ok(spoken.audio.length>20000,"real audio");
      const text=await new LocalTranscriber("http://127.0.0.1:18178/v1").transcribe(to16kMono(spoken.audio),"audio/wav","voice.wav","ar");
      assert.ok(text.trim().length>0,"Whisper returned text");
      return `wav ${spoken.audio.length} bytes; heard: ${text.slice(0,80)}`;
    }finally{piper.kill();whisper.kill();}
  });
}
/** PCM16 WAV (any rate, mono/stereo) -> 16 kHz mono, which whisper-server expects. */
function to16kMono(wav:Buffer):Buffer{
  let off=12,rate=16000,channels=1,bits=16,data:Buffer|null=null;
  while(off+8<=wav.length){const id=wav.toString("ascii",off,off+4),size=wav.readUInt32LE(off+4);
    if(id==="fmt "){channels=wav.readUInt16LE(off+10);rate=wav.readUInt32LE(off+12);bits=wav.readUInt16LE(off+22);}
    if(id==="data"){data=wav.subarray(off+8,off+8+size);break;}
    off+=8+size+(size%2);}
  if(!data||bits!==16)throw new Error("unexpected WAV format");
  const frames=Math.floor(data.length/2/channels);const src=new Float32Array(frames);
  for(let i=0;i<frames;i++){let v=0;for(let c=0;c<channels;c++)v+=data.readInt16LE((i*channels+c)*2);src[i]=v/channels;}
  const n=Math.floor(frames*16000/rate);const out=Buffer.alloc(44+n*2);
  out.write("RIFF",0,"ascii");out.writeUInt32LE(36+n*2,4);out.write("WAVE",8,"ascii");out.write("fmt ",12,"ascii");out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(16000,24);out.writeUInt32LE(32000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write("data",36,"ascii");out.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++){const p=i*rate/16000,j=Math.floor(p),f=p-j;const v=(src[j]??0)*(1-f)+(src[j+1]??src[j]??0)*f;out.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v))),44+i*2);}
  return out;
}
const failed=results.filter(r=>!r.ok);
console.log(JSON.stringify({windowsSmoke:{passed:results.length-failed.length,failed:failed.length,results}},null,1));
process.exit(failed.length?1:0);
