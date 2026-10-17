import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {voiceUiHtml} from "../src/voice/ui.js";
import {FAKE_MIC,launchBrowser,until,voiceWav} from "./helpers/voice-page.js";

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
const micFile=path.join(os.tmpdir(),`lx-tts-mic-${process.pid}.wav`);
fs.writeFileSync(micFile,voiceWav([[2.5,false],[1.4,true],[8,false]]));
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


async function scenario(name:string,o:{localStt:boolean;args:string[];init:string;path:string;act?:(tab:any)=>Promise<void>;check:(seen:any,tab:any)=>Promise<void>}){
  const {s,seen}=serve(o.localStt);await new Promise<void>(r=>s.listen(0,"127.0.0.1",()=>r()));
  const browser=await launchBrowser(o.args);
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

await scenario("local speech-to-text, no click: played",{localStt:true,args:[...FAKE_MIC,`--use-file-for-fake-audio-capture=${micFile}`],init:"",path:"/voice?listen=1",
  check:async seen=>{await until(()=>seen.played>0||seen.blocked>0,15000);
    assert.deepEqual(seen.assistant.slice(0,1),["أعطني تقرير اليوم"]);assert.ok(seen.speak.includes(REPLY));
    assert.equal(seen.blocked,0);assert.equal(seen.played,1);assert.deepEqual(seen.activeAtPlay,[false],"played with no click at all");}});

await scenario("browser recognition, always listening, no click: the held microphone lets the reply play",{localStt:false,args:FAKE_MIC,init:FAKE_SR,path:"/voice?listen=1",
  check:async(seen,tab)=>{await until(()=>seen.played>0||seen.blocked>0,10000);
    assert.deepEqual(seen.assistant,["أعطني تقرير اليوم"]);assert.deepEqual(seen.speak,[REPLY]);
    assert.equal(seen.blocked,0);assert.equal(seen.played,1);assert.deepEqual(seen.activeAtPlay,[false],"played with no click at all");
    assert.equal(await tab.evaluate(()=>(window as any).__layanx.holdingMic()),true);
    assert.equal(await tab.isHidden("#soundBtn"),true);}});

// A slow PC: the microphone takes 1.5 s to open and the reply comes before that. It waits, then plays.
const SLOW_MIC=`(function(){var g=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=function(c){return new Promise(function(r){setTimeout(r,1500)}).then(function(){return g(c)})}})();`;
await scenario("slow microphone, fast reply: the reply waits for it and plays",{localStt:false,args:FAKE_MIC,init:FAKE_SR.replace("},1500)","},200)")+SLOW_MIC,path:"/voice?listen=1",
  check:async seen=>{await until(()=>seen.played>0||seen.blocked>0,10000);
    assert.deepEqual(seen.speak,[REPLY]);assert.equal(seen.blocked,0,"not blocked");assert.equal(seen.played,1);assert.deepEqual(seen.activeAtPlay,[false]);}});

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
