import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import path from "node:path";
import {detectLocalStt} from "../src/voice/detect.js";
import {LocalTranscriber} from "../src/voice/service.js";

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")),"..");

// 1. Engine choice: Cohere when it runs (even while loading), else Whisper; the owner can force either.
const fakeFetch=(up:Record<number,unknown>)=>(async(url:string|URL)=>{
  const port=Number(new URL(String(url)).port);const body=up[port];
  if(body===undefined)throw new Error("ECONNREFUSED");
  return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
}) as typeof fetch;
const cohere={ok:true,engine:"cohere-transcribe-arabic",ready:false},whisper={};
assert.deepEqual(await detectLocalStt({},fakeFetch({8181:cohere,8178:whisper})),{engine:"cohere",baseUrl:"http://127.0.0.1:8181/v1",ready:false});
assert.deepEqual(await detectLocalStt({},fakeFetch({8178:whisper})),{engine:"whisper",baseUrl:"http://127.0.0.1:8178/v1"});
assert.deepEqual(await detectLocalStt({LAYANX_STT_ENGINE:"whisper"},fakeFetch({8181:cohere,8178:whisper})),{engine:"whisper",baseUrl:"http://127.0.0.1:8178/v1"});
assert.equal(await detectLocalStt({LAYANX_STT_ENGINE:"cohere"},fakeFetch({8178:whisper})),null);
assert.deepEqual(await detectLocalStt({},fakeFetch({8181:{ok:false,engine:"cohere-transcribe-arabic",error:"no torch"},8178:whisper})),{engine:"whisper",baseUrl:"http://127.0.0.1:8178/v1"},"a broken Cohere install falls back to Whisper");
assert.deepEqual(await detectLocalStt({},fakeFetch({8181:{engine:"something-else"}})),null,"another program on 8181 is not mistaken for Cohere");
assert.equal((await detectLocalStt({LAYANX_COHERE_PORT:"9001"},fakeFetch({9001:cohere})))?.baseUrl,"http://127.0.0.1:9001/v1");

// 1b. Cohere failing (loading, crashed): Whisper running next to it answers instead.
{
  const http=await import("node:http");
  const serve=(handler:(res:import("node:http").ServerResponse)=>void)=>new Promise<{url:string;close:()=>void}>(r=>{
    const srv=http.createServer((req,res)=>{req.resume();req.on("end",()=>handler(res));});
    srv.listen(0,"127.0.0.1",()=>r({url:`http://127.0.0.1:${(srv.address() as import("node:net").AddressInfo).port}/v1`,close:()=>srv.close()}));
  });
  const down=await serve(res=>{res.writeHead(503,{"content-type":"application/json"});res.end(JSON.stringify({error:"model loading"}));});
  const backup=await serve(res=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({text:"مرحبا من Whisper"}));});
  const {VoiceService}=await import("../src/voice/service.js");
  const noCloud={status:()=>({enabled:false}),transcribe:async()=>{throw new Error("cloud must not be used");}} as any;
  const svc=new VoiceService(noCloud,new LocalTranscriber(down.url),null,null,new LocalTranscriber(backup.url));
  assert.equal(await svc.transcribe(Buffer.from("x"),"audio/webm","a.webm","ar"),"مرحبا من Whisper");
  assert.equal(svc.status().localStt?.backupUrl,backup.url);
  const alone=new VoiceService(noCloud,new LocalTranscriber(down.url),null,null,null);
  await assert.rejects(alone.transcribe(Buffer.from("x"),"audio/webm","a.webm","ar"),/503/,"no backup and no cloud: the real error");
  down.close();backup.close();
}

// 1c. The installer brings every library the model's own code imports (librosa was missing once: the sample
// test failed on a real PC with "pip install librosa").
{
  const fs=await import("node:fs");
  const installer=fs.readFileSync(path.join(root,"scripts","windows","install-cohere-asr.ps1"),"utf8");
  assert.match(installer,/\$LibrosaVersion = '\d+\.\d+\.\d+'/,"librosa is pinned");
  assert.match(installer,/pip install[^\n]*"librosa==\$LibrosaVersion"/,"librosa is installed with transformers");
}

// 2. The Python server's HTTP side (multipart from LayanX's own client, WAV decoding), with the model stubbed.
const python=process.platform==="win32"?"python":"python3";
let numpy=false;try{execFileSync(python,["-c","import numpy"],{stdio:"ignore"});numpy=true;}catch{}
if(!numpy)console.log("cohere-asr: Python server part skipped (python with numpy not found)");
else{
  const script=path.join(root,"scripts","voice-sense","cohere_asr_server.py");
  // Without a model and without the stub it refuses to start, with a pointer to the installer.
  let out="";try{execFileSync(python,[script,"--model",path.join(root,"no-such-model"),"--port","1"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}catch(e){out=String((e as {stderr?:string}).stderr??"");}
  assert.match(out,/install-cohere-asr\.ps1/);
  // The real transcribe() path with stand-ins shaped like transformers 5.4 (a list in the processor output).
  const engineCheck=JSON.parse(execFileSync(python,[path.join(root,"tests","fixtures","cohere_engine_check.py"),path.join(root,"scripts","voice-sense")],{encoding:"utf8"}).trim().split("\n").pop()!);
  for(const kind of ["batch","dict"]){
    assert.equal(engineCheck[kind].text,"مرحبا بك",kind+": chunked output decoded to one text");
    assert.deepEqual(engineCheck[kind].moves,["input_features","attention_mask"],kind+": only tensors are moved, the chunk index list stays as it is");
  }
  // The self-test prints an Arabic transcript; on a Windows console (cp1252) that once crashed after a
  // successful transcription. It must exit 0 whatever the console's code page.
  {
    const fs=await import("node:fs"),os=await import("node:os");
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"lx-cohere-"));const sample=path.join(tmp,"s.wav");
    const n=16000;const w=Buffer.alloc(44+n*2);
    w.write("RIFF",0,"ascii");w.writeUInt32LE(36+n*2,4);w.write("WAVE",8,"ascii");w.write("fmt ",12,"ascii");w.writeUInt32LE(16,16);w.writeUInt16LE(1,20);w.writeUInt16LE(1,22);
    w.writeUInt32LE(16000,24);w.writeUInt32LE(32000,28);w.writeUInt16LE(2,32);w.writeUInt16LE(16,34);w.write("data",36,"ascii");w.writeUInt32LE(n*2,40);fs.writeFileSync(sample,w);
    const out=execFileSync(python,[script,"--model","unused","--selftest",sample],{encoding:"utf8",env:{...process.env,LAYANX_COHERE_FAKE:"1",LAYANX_COHERE_FAKE_TEXT:"مرحبا أنا ليان",PYTHONIOENCODING:"cp1252"}});
    const line=JSON.parse(out.trim().split("\n").pop()!.replace(/\\u([0-9a-f]{4})/g,(_m:string,h:string)=>String.fromCharCode(parseInt(h,16))));
    assert.equal(line.ok,true);assert.equal(line.text,"مرحبا أنا ليان","the transcript survives a console without Arabic");
    fs.rmSync(tmp,{recursive:true,force:true});
  }
  const port=19100+Math.floor(Math.random()*500);
  const child=spawn(python,[script,"--model","unused","--port",String(port)],{env:{...process.env,LAYANX_COHERE_FAKE:"1"},stdio:"ignore"});
  try{
    let health:any=null;
    for(let i=0;i<60&&!health?.ready;i++){await new Promise(r=>setTimeout(r,200));health=await fetch(`http://127.0.0.1:${port}/`).then(r=>r.json()).catch(()=>null);}
    assert.equal(health?.engine,"cohere-transcribe-arabic");assert.equal(health.ready,true);
    assert.deepEqual(await detectLocalStt({LAYANX_COHERE_PORT:String(port)}),{engine:"cohere",baseUrl:`http://127.0.0.1:${port}/v1`,ready:true});
    const rate=22050,n=rate*2;const wav=Buffer.alloc(44+n*2);
    wav.write("RIFF",0,"ascii");wav.writeUInt32LE(36+n*2,4);wav.write("WAVE",8,"ascii");wav.write("fmt ",12,"ascii");wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36,"ascii");wav.writeUInt32LE(n*2,40);
    const text=await new LocalTranscriber(`http://127.0.0.1:${port}/v1`).transcribe(wav,"audio/wav","voice.wav","ar");
    assert.equal(text,"[fake:ar:2.0s]","multipart form parsed, 22.05 kHz resampled to 16 kHz");
    // A web page's simple request (no x-layanx-client header) is refused; so is a foreign Host (DNS rebinding).
    const fromPage=await fetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`,{method:"POST",headers:{"content-type":"text/plain"},body:"x"});
    assert.equal(fromPage.status,403);
    const bad=await fetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`,{method:"POST",headers:{"content-type":"text/plain","x-layanx-client":"t"},body:"x"});
    assert.equal(bad.status,400);
    const {request}=await import("node:http");
    const rebinding=await new Promise<number>(r=>{const q=request({host:"127.0.0.1",port,path:"/",headers:{host:`evil.example:${port}`}},res=>{res.resume();r(res.statusCode??0);});q.end();});
    assert.equal(rebinding,403);
    // Odd sample rates are refused before any work.
    const odd=Buffer.from(wav);odd.writeUInt32LE(1000,24);odd.writeUInt32LE(2000,28);
    const form=new FormData();form.append("file",new Blob([new Uint8Array(odd)],{type:"audio/wav"}),"a.wav");
    const oddRes=await fetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`,{method:"POST",headers:{"x-layanx-client":"t"},body:form});
    assert.equal(oddRes.status,400);assert.match(await oddRes.text(),/8 and 48 kHz/);
  }finally{child.kill();}
}
console.log("cohere-asr: engine choice (Cohere / Whisper / forced / broken install) and the OpenAI-compatible server verified");
process.exit(0);
