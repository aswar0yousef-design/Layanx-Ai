import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {VoiceService} from "../src/voice/service.js";
import {VoiceSense,isWav} from "../src/voice/sense.js";
import {voiceUiHtml} from "../src/voice/ui.js";

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")),"..");
function wav(seconds:Array<[number,boolean]>,rate=16000):Buffer{
  // Speech-like harmonic buzz (voiced) or silence, segment by segment.
  const total=seconds.reduce((a,[s])=>a+Math.round(s*rate),0);const out=Buffer.alloc(44+total*2);let i=0;
  out.write("RIFF",0,"ascii");out.writeUInt32LE(36+total*2,4);out.write("WAVE",8,"ascii");out.write("fmt ",12,"ascii");out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write("data",36,"ascii");out.writeUInt32LE(total*2,40);
  for(const [s,voiced] of seconds)for(let k=0;k<Math.round(s*rate);k++,i++){
    const t=i/rate;const v=voiced?(0.3*Math.sin(2*Math.PI*140*t)+0.2*Math.sin(2*Math.PI*280*t)+0.1*Math.sin(2*Math.PI*420*t))*(0.6+0.4*Math.abs(Math.sin(2*Math.PI*3*t))):0;
    out.writeInt16LE(Math.round(v*32767),44+i*2);
  }
  return out;
}
const durationOf=(w:Buffer)=>(w.length-44)/2/w.readUInt32LE(24);
/** Number of voiced stretches (>=150 ms above the noise) in a clip: the "parts" of what was said. */
function voicedRuns(w:Buffer):number{
  const rate=w.readUInt32LE(24),win=Math.round(rate*0.05);let runs=0,loud=0;
  for(let o=44;o+win*2<=w.length;o+=win*2){
    let sum=0;for(let i=0;i<win;i++){const v=w.readInt16LE(o+i*2)/32768;sum+=v*v;}
    if(Math.sqrt(sum/win)>0.05)loud+=0.05;
    else{if(loud>=0.15)runs++;loud=0;}
  }
  return runs+(loud>=0.15?1:0);
}

// 1. Service: clips without speech never reach Whisper; non-WAV audio is not gated; turn() needs the sense server.
const vadCalls:number[]=[];
const sense=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
  const body=Buffer.concat(chunks);const send=(d:unknown)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(d));};
  if(req.url==="/vad"){vadCalls.push(body.length);let peak=0;for(let i=44;i+1<body.length;i+=2)peak=Math.max(peak,Math.abs(body.readInt16LE(i)));return send({speech:peak>1000,maxProb:peak>1000?0.99:0.01,speechMs:peak>1000?500:0,durationMs:1000});}
  if(req.url==="/turn")return send({complete:durationOf(body)>2,probability:durationOf(body)>2?0.91:0.12});
  res.writeHead(404);res.end();});});
await new Promise<void>(r=>sense.listen(0,"127.0.0.1",()=>r()));
const senseUrl=`http://127.0.0.1:${(sense.address() as {port:number}).port}`;
let whisperCalls=0;
const fakeLocal={baseUrl:"local",model:"whisper",transcribe:async()=>{whisperCalls++;return"مرحبا ليان";}} as any;
const service=new VoiceService({name:"x",status:()=>({enabled:false,provider:"x",transcriptionModel:"",speechModel:"",voice:""}),transcribe:async()=>"",speak:async()=>({audio:Buffer.alloc(0),contentType:""})},fakeLocal,null,new VoiceSense(senseUrl));
assert.equal(await service.transcribe(wav([[1,false]]),"audio/wav","a.wav","ar"),"","silence is not transcribed");
assert.equal(whisperCalls,0);
assert.equal(await service.transcribe(wav([[1,true]]),"audio/wav","a.wav","ar"),"مرحبا ليان");
assert.equal(whisperCalls,1);
assert.equal(await service.transcribe(Buffer.from("webm-bytes-not-wav-at-all-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),"audio/webm","a.webm","ar"),"مرحبا ليان","non-WAV goes straight to the engine");
assert.equal(vadCalls.length,2);
assert.deepEqual(await service.turn(wav([[2.5,true]])),{complete:true,probability:0.91});
assert.deepEqual(service.status().sense,{baseUrl:senseUrl});
assert.equal(await new VoiceService(undefined,fakeLocal,null,null).turn(wav([[1,true]])),null);
assert.equal(isWav(wav([[0.1,false]])),true);assert.equal(isWav(Buffer.from("OggS".padEnd(60,"x"))),false);

// 2. The real sense server (Python + onnxruntime + the pinned models), when this machine has them.
const models=process.env.LAYANX_TEST_VOICE_MODELS;
const python=process.platform==="win32"?"python":"python3";
let pyOk=false;try{execFileSync(python,["-c","import onnxruntime,numpy"],{stdio:"ignore"});pyOk=true;}catch{}
if(models&&pyOk&&fs.existsSync(path.join(models,"silero_vad.onnx"))){
  const port=18000+Math.floor(Math.random()*500);
  const child=spawn(python,[path.join(root,"scripts","voice-sense","server.py"),"--models",models,"--port",String(port)],{stdio:"ignore"});
  try{
    let ok=false;for(let i=0;i<60&&!ok;i++){await new Promise(r=>setTimeout(r,250));ok=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.ok).catch(()=>false);}
    assert.ok(ok,"sense server started");
    const real=new VoiceSense(`http://127.0.0.1:${port}`);
    assert.equal((await real.vad(wav([[1,false]]))).speech,false);
    assert.equal((await real.vad(wav([[1.5,true]],22050))).speech,true,"resamples 22.05 kHz");
    const t=await real.turn(wav([[2,true],[0.3,false]]));
    assert.ok(t.probability>=0&&t.probability<=1);
    console.log("voice-sense: real Silero/Smart Turn server checked");
  }finally{child.kill();}
}else console.log("voice-sense: real model server skipped (set LAYANX_TEST_VOICE_MODELS to the models folder)");
// A model whose hash does not match is refused.
if(pyOk){
  const bad=fs.mkdtempSync(path.join(os.tmpdir(),"lx-vs-bad-"));
  fs.writeFileSync(path.join(bad,"silero_vad.onnx"),"tampered");fs.writeFileSync(path.join(bad,"smart-turn-v3.2-cpu.onnx"),"tampered");
  let out="";try{execFileSync(python,[path.join(root,"scripts","voice-sense","server.py"),"--models",bad,"--port","1"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}catch(e){out=String((e as {stderr?:string}).stderr??"");}
  if(!/No module named/.test(out))assert.match(out,/does not match its pinned SHA-256/);
  fs.rmSync(bad,{recursive:true,force:true});
}

// 3. The voice page with a fake microphone: a 1 s pause mid-sentence does not cut the command (Smart Turn says
//    "not finished"), and the whole sentence goes to transcription once the turn is complete.
let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
const audioFile=path.join(os.tmpdir(),`lx-mic-${process.pid}.wav`);
// Leading silence leaves time for the page to open the microphone (slow on CI machines).
fs.writeFileSync(audioFile,wav([[2.5,false],[1.2,true],[1.0,false],[1.0,true],[5,false]],48000));
const seen:{turn:Array<{runs:number;complete:boolean}>;transcribe:Array<{seconds:number;runs:number}>;assistant:string[]}={turn:[],transcribe:[],assistant:[]};
const page=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
  const body=Buffer.concat(chunks);const send=(d:unknown)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(d));};
  if(req.url==="/voice"){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(voiceUiHtml());return;}
  if(req.url==="/v1/voice/status")return send({ok:true,voice:{enabled:false,localStt:{baseUrl:"x",model:"whisper"},stt:"local",tts:"browser",sense:{baseUrl:"y"}}});
  // Stand-in for Smart Turn: the sentence is complete once both parts were said.
  if(req.url==="/v1/voice/turn"){const runs=voicedRuns(body),complete=runs>=2;seen.turn.push({runs,complete});return send({ok:true,complete,probability:complete?0.9:0.1});}
  if(req.url==="/v1/voice/transcribe"){seen.transcribe.push({seconds:durationOf(body),runs:voicedRuns(body)});return send({ok:true,text:"أعطني تقرير اليوم"});}
  if(req.url==="/v1/assistant/turn"){seen.assistant.push(JSON.parse(body.toString()).text);return send({ok:true,reply:"حسناً",lang:"ar"});}
  if(req.url==="/v1/assistant/briefing")return send({ok:true,briefing:null});
  res.writeHead(404);res.end("{}");});});
await new Promise<void>(r=>page.listen(0,"127.0.0.1",()=>r()));
const pagePort=(page.address() as {port:number}).port;
let browser:any=null;
if(pw){
  const chromium=pw.chromium??pw.default?.chromium;
  const args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream",`--use-file-for-fake-audio-capture=${audioFile}`,"--autoplay-policy=no-user-gesture-required"];
  for(const a of [...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),{channel:"msedge"},{channel:"chrome"}]){try{browser=await chromium.launch({headless:true,args,...a});break;}catch{}}
}
if(!browser)console.log("voice-sense: page test skipped (no browser)");
else{
  try{
    const tab=await browser.newPage();
    await tab.goto(`http://127.0.0.1:${pagePort}/voice`);
    await tab.waitForFunction(()=>(window as any).__layanx?.useLocal?.()===true,null,{timeout:10000});
    await tab.click("#orb");
    const end=Date.now()+20000;
    while(!seen.assistant.length&&Date.now()<end+10000)await new Promise(r=>setTimeout(r,100));
    assert.equal(seen.transcribe.length,1,"one utterance, not split at the mid-sentence pause: "+JSON.stringify(seen));
    assert.equal(seen.transcribe[0]!.runs,2,"the whole sentence (both parts) was transcribed: "+JSON.stringify(seen));
    assert.ok(seen.turn.some(t=>!t.complete),"asked during the mid-sentence pause and was told to wait: "+JSON.stringify(seen.turn));
    assert.deepEqual(seen.assistant,["أعطني تقرير اليوم"]);
    console.log(`voice-sense: page kept listening through a 1 s pause (${seen.turn.length} turn checks), sent ${seen.transcribe[0]!.seconds.toFixed(1)} s with both parts once complete`);
  }finally{await browser.close();}
}
page.close();sense.close();fs.rmSync(audioFile,{force:true});
console.log("voice-sense: VAD gating before Whisper, turn detection route, model hash pinning and the voice page flow verified");
process.exit(0);
