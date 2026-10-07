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

// 2. The Python server's HTTP side (multipart from LayanX's own client, WAV decoding), with the model stubbed.
const python=process.platform==="win32"?"python":"python3";
let numpy=false;try{execFileSync(python,["-c","import numpy"],{stdio:"ignore"});numpy=true;}catch{}
if(!numpy)console.log("cohere-asr: Python server part skipped (python with numpy not found)");
else{
  const script=path.join(root,"scripts","voice-sense","cohere_asr_server.py");
  // Without a model and without the stub it refuses to start, with a pointer to the installer.
  let out="";try{execFileSync(python,[script,"--model",path.join(root,"no-such-model"),"--port","1"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}catch(e){out=String((e as {stderr?:string}).stderr??"");}
  assert.match(out,/install-cohere-asr\.ps1/);
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
    const bad=await fetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`,{method:"POST",headers:{"content-type":"text/plain"},body:"x"});
    assert.equal(bad.status,400);
  }finally{child.kill();}
}
console.log("cohere-asr: engine choice (Cohere / Whisper / forced / broken install) and the OpenAI-compatible server verified");
process.exit(0);
