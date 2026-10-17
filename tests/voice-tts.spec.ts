import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {voiceUiHtml} from "../src/voice/ui.js";

/**
 * The assistant's reply is spoken. Browsers play sound only after a click on the page or while the
 * page uses the microphone; opened by LayanX (?listen=1) and spoken to without a click, replies were
 * silent with the browser's speech recognition. Checked here in Chromium:
 *  1. typed request: Piper's WAV is fetched and played;
 *  2. local speech-to-text (microphone open), no click: played;
 *  3. browser speech recognition, always listening, no click: the page holds the microphone, so the
 *     reply is played;
 *  4. sound still blocked (no microphone at all): a one-click button appears and plays the missed reply.
 */
const wav=(()=>{const n=8000,b=Buffer.alloc(44+n*2);b.write("RIFF",0,"ascii");b.writeUInt32LE(36+n*2,4);b.write("WAVE",8,"ascii");b.write("fmt ",12,"ascii");b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36,"ascii");b.writeUInt32LE(n*2,40);return b;})();
const REPLY="حسناً، هذا تقرير اليوم";
/** A fake microphone file: silence, then 1.4 s of voice-like sound (the request), then silence. */
function micWav(parts:Array<[number,boolean]>,rate=48000):Buffer{
  const total=parts.reduce((a,[sec])=>a+Math.round(sec*rate),0);const out=Buffer.alloc(44+total*2);let i=0;
  out.write("RIFF",0,"ascii");out.writeUInt32LE(36+total*2,4);out.write("WAVE",8,"ascii");out.write("fmt ",12,"ascii");out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write("data",36,"ascii");out.writeUInt32LE(total*2,40);
  for(const [sec,voiced] of parts)for(let k=0;k<Math.round(sec*rate);k++,i++){const t=i/rate;
    const v=voiced?(0.3*Math.sin(2*Math.PI*140*t)+0.2*Math.sin(2*Math.PI*280*t)+0.1*Math.sin(2*Math.PI*420*t))*(0.6+0.4*Math.abs(Math.sin(2*Math.PI*3*t))):0;
    out.writeInt16LE(Math.round(v*32767),44+i*2);}
  return out;
}
const micFile=path.join(os.tmpdir(),`lx-tts-mic-${process.pid}.wav`);
fs.writeFileSync(micFile,micWav([[2.5,false],[1.4,true],[8,false]]));
function serve(localStt:boolean){
  const seen={speak:[] as string[],assistant:[] as string[],played:0,blocked:0,activeAtPlay:[] as boolean[]};
  const s=http.createServer((req,res)=>{const c:Buffer[]=[];req.on("data",x=>c.push(x));req.on("end",()=>{const body=Buffer.concat(c);const send=(d:unknown)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(d));};
    if(req.url?.startsWith("/voice")){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(voiceUiHtml());return;}
    if(req.url==="/v1/voice/status")return send({ok:true,voice:{enabled:false,...(localStt?{stt:"local",localStt:{baseUrl:"x",model:"w"}}:{stt:"none"}),tts:"local"}});
    if(req.url==="/v1/voice/transcribe")return send({ok:true,text:"ليان أعطني تقرير اليوم"});
    if(req.url==="/v1/assistant/turn"){seen.assistant.push(JSON.parse(body.toString()).text);return send({ok:true,reply:REPLY,lang:"ar"});}
    if(req.url==="/v1/voice/speak"){seen.speak.push(JSON.parse(body.toString()).text);res.writeHead(200,{"content-type":"audio/wav"});res.end(wav);return;}
    if(req.url==="/v1/assistant/briefing")return send({ok:true,briefing:null});
    // The page reports what really played; reading it from the page would itself count as a click.
    if(req.url?.startsWith("/__played")){seen.played++;seen.activeAtPlay.push(req.url.endsWith("=true"));return send({ok:true});}
    if(req.url==="/__blocked"){seen.blocked++;return send({ok:true});}
    res.writeHead(404);res.end("{}");});});
  return{s,seen};
}
// Counts what was really played (and what the browser refused). Plain script: the test compiler must not rewrite it.
const SPY=`var _play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){var p=_play.call(this);var a=!!(navigator.userActivation&&navigator.userActivation.hasBeenActive);
 p.then(function(){fetch("/__played?active="+a,{method:"POST"})},function(e){if(e&&e.name==="NotAllowedError")fetch("/__blocked",{method:"POST"})});return p};`;
const FAKE_SR=`function FakeSR(){this.dead=false}FakeSR.prototype.start=function(){var self=this;window.__srStarts=(window.__srStarts||0)+1;if(window.__srStarts!==1)return;
 setTimeout(function(){if(self.dead)return;var r=[{transcript:"ليان أعطني تقرير اليوم"}];r.isFinal=true;self.onresult&&self.onresult({resultIndex:0,results:[r]})},1500)};
 FakeSR.prototype.abort=function(){var self=this;this.dead=true;setTimeout(function(){self.onend&&self.onend()},5)};FakeSR.prototype.stop=FakeSR.prototype.abort;
 window.SpeechRecognition=FakeSR;window.webkitSpeechRecognition=FakeSR;`;

let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
const launch=async(args:string[])=>{
  const chromium=pw?.chromium??pw?.default?.chromium;if(!chromium)return null;
  for(const a of [...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),{channel:"msedge"},{channel:"chrome"}]){try{return await chromium.launch({headless:true,args,...a});}catch{}}
  return null;
};
const until=async(f:()=>Promise<boolean>|boolean,ms:number)=>{const end=Date.now()+ms;while(!(await f())&&Date.now()<end)await new Promise(r=>setTimeout(r,100));};
const MIC=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"];

async function scenario(name:string,o:{localStt:boolean;args:string[];init:string;path:string;act?:(tab:any)=>Promise<void>;check:(seen:any,tab:any)=>Promise<void>}){
  const {s,seen}=serve(o.localStt);await new Promise<void>(r=>s.listen(0,"127.0.0.1",()=>r()));
  const browser=await launch(o.args);
  if(!browser){console.log("voice-tts: "+name+" skipped (no browser)");s.close();return;}
  try{
    const tab=await browser.newPage();const errors:string[]=[];tab.on("pageerror",(e:any)=>errors.push(String(e)));
    await tab.addInitScript(SPY+o.init);
    await tab.goto(`http://127.0.0.1:${(s.address() as {port:number}).port}${o.path}`);
    if(o.act)await o.act(tab);
    await o.check(seen,tab);
    assert.deepEqual(errors,[]);
    console.log("voice-tts: "+name);
  }finally{await browser.close();s.close();}
}

await scenario("typed request: Piper voice played",{localStt:false,args:[],init:"",path:"/voice",
  act:async tab=>{await tab.fill("#sayInput","أعطني تقرير اليوم");await tab.click("#sendBtn");},
  check:async seen=>{await until(()=>seen.played>0,8000);assert.deepEqual(seen.speak,[REPLY]);assert.equal(seen.played,1);}});

await scenario("local speech-to-text, no click: played",{localStt:true,args:[...MIC,`--use-file-for-fake-audio-capture=${micFile}`],init:"",path:"/voice?listen=1",
  check:async seen=>{await until(()=>seen.played>0||seen.blocked>0,15000);
    assert.deepEqual(seen.assistant.slice(0,1),["أعطني تقرير اليوم"]);assert.ok(seen.speak.includes(REPLY));
    assert.equal(seen.blocked,0);assert.equal(seen.played,1);assert.deepEqual(seen.activeAtPlay,[false],"played with no click at all");}});

await scenario("browser recognition, always listening, no click: the held microphone lets the reply play",{localStt:false,args:MIC,init:FAKE_SR,path:"/voice?listen=1",
  check:async(seen,tab)=>{await until(()=>seen.played>0||seen.blocked>0,10000);
    assert.deepEqual(seen.assistant,["أعطني تقرير اليوم"]);assert.deepEqual(seen.speak,[REPLY]);
    assert.equal(seen.blocked,0);assert.equal(seen.played,1);assert.deepEqual(seen.activeAtPlay,[false],"played with no click at all");
    assert.equal(await tab.evaluate(()=>(window as any).__layanx.holdingMic()),true);
    assert.equal(await tab.isHidden("#soundBtn"),true);}});

const NO_MIC=`navigator.mediaDevices.getUserMedia=function(){return Promise.reject(new DOMException("no microphone","NotFoundError"))};`;
await scenario("sound blocked (no microphone): one click plays the missed reply",{localStt:false,args:[],init:FAKE_SR+NO_MIC,path:"/voice?listen=1",
  check:async(seen,tab)=>{await until(()=>seen.blocked>0,10000);
    assert.equal(seen.played,0);
    assert.equal(await tab.isVisible("#soundBtn"),true,"the one-click button appears instead of silence");
    await tab.click("#soundBtn");
    await until(()=>seen.played>0,8000);
    assert.equal(seen.played,1);assert.deepEqual(seen.speak,[REPLY,REPLY],"the missed reply is spoken after the click");
    assert.equal(await tab.isHidden("#soundBtn"),true);}});

fs.rmSync(micFile,{force:true});
console.log("voice-tts: replies are spoken (Piper), also when the assistant was opened without a click");
process.exit(0);
