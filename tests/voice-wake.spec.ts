import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {voiceUiHtml} from "../src/voice/ui.js";

/**
 * "Layan … <pause> … command": the command after the name must reach the assistant.
 *  1. Local speech-to-text (Whisper/Cohere): the microphone keeps listening while the name is
 *     being transcribed (slow on a CPU), so the command said right after it is not lost.
 *  2. Browser speech recognition: hearing the name alone does not stop the recognizer; the next
 *     thing said is the command.
 */
function wav(seconds:Array<[number,boolean]>,rate=16000):Buffer{
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
/** Seconds of sound in a clip (50 ms windows above the noise). */
function voicedSeconds(w:Buffer):number{
  const rate=w.readUInt32LE(24),win=Math.round(rate*0.05);let loud=0;
  for(let o=44;o+win*2<=w.length;o+=win*2){let sum=0;for(let i=0;i<win;i++){const v=w.readInt16LE(o+i*2)/32768;sum+=v*v;}if(Math.sqrt(sum/win)>0.02)loud+=0.05;}
  return loud;
}

let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
const launch=async(args:string[])=>{
  const chromium=pw?.chromium??pw?.default?.chromium;if(!chromium)return null;
  for(const a of [...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),{channel:"msedge"},{channel:"chrome"}]){try{return await chromium.launch({headless:true,args,...a});}catch{}}
  return null;
};

function server(opts:{localStt:boolean;transcribe:(voiced:number,n:number)=>Promise<string>}){
  const seen={transcribe:[] as number[],assistant:[] as string[]};
  const s=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",async()=>{
    const body=Buffer.concat(chunks);const send=(d:unknown)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(d));};
    if(req.url?.startsWith("/voice")){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(voiceUiHtml());return;}
    if(req.url==="/v1/voice/status")return send({ok:true,voice:{enabled:false,...(opts.localStt?{localStt:{baseUrl:"x",model:"whisper"},stt:"local"}:{stt:"none"}),tts:"browser"}});
    if(req.url==="/v1/voice/transcribe"){seen.transcribe.push(durationOf(body));(seen as any).voiced=[...((seen as any).voiced??[]),+voicedSeconds(body).toFixed(2)];return send({ok:true,text:await opts.transcribe(voicedSeconds(body),seen.transcribe.length)});}
    if(req.url==="/v1/assistant/turn"){seen.assistant.push(JSON.parse(body.toString()).text);return send({ok:true,reply:"حسناً",lang:"ar"});}
    if(req.url==="/v1/assistant/briefing")return send({ok:true,briefing:null});
    res.writeHead(404);res.end("{}");});});
  return{s,seen};
}
const listen=async(s:http.Server)=>{await new Promise<void>(r=>s.listen(0,"127.0.0.1",()=>r()));return(s.address() as {port:number}).port;};
const until=async(f:()=>boolean,ms:number)=>{const end=Date.now()+ms;while(!f()&&Date.now()<end)await new Promise(r=>setTimeout(r,100));};

// ---------- 1. local speech-to-text: the name, a pause, then the command while the name is still being transcribed ----------
{
  const audioFile=path.join(os.tmpdir(),`lx-wake-${process.pid}.wav`);
  // silence (page opens the mic) · "Layan" 0.6 s · 1.5 s pause · command 1.4 s · silence
  fs.writeFileSync(audioFile,wav([[2.5,false],[0.6,true],[1.5,false],[1.4,true],[6,false]],48000));
  // Transcribing is slow (a CPU model): the first clip takes 1.8 s, longer than the pause before the command.
  const {s,seen}=server({localStt:true,transcribe:async(voiced,n)=>{
    if(n===1){await new Promise(r=>setTimeout(r,1800));return"ليان";}
    // A clip holding only the end of the command is heard as its last word, as a real model would.
    return voiced>=1.1?"أعطني تقرير اليوم":"اليوم";}});
  const port=await listen(s);
  const browser=await launch(["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream",`--use-file-for-fake-audio-capture=${audioFile}`,"--autoplay-policy=no-user-gesture-required"]);
  if(!browser)console.log("voice-wake: local test skipped (no browser)");
  else try{
    const tab=await browser.newPage();
    const pageErrors:string[]=[];tab.on("pageerror",(e:any)=>pageErrors.push(String(e)));
    await tab.goto(`http://127.0.0.1:${port}/voice?listen=1`);
    await tab.waitForFunction(()=>(window as any).__layanx?.useLocal?.()===true,null,{timeout:10000});
    await until(()=>seen.assistant.length>0,20000);
    assert.deepEqual(seen.assistant,["أعطني تقرير اليوم"],"the command after the name reached the assistant, word for word: "+JSON.stringify(seen));
    assert.deepEqual(pageErrors,[]);
    console.log(`voice-wake: local STT kept listening while the name was transcribed (${seen.transcribe.length} clips: ${seen.transcribe.map(x=>x.toFixed(1)).join(", ")} s)`);
  }finally{await browser.close();}
  s.close();fs.rmSync(audioFile,{force:true});
}

// ---------- 2. browser speech recognition: the name alone, then the command, in one recognizer session ----------
{
  const {s,seen}=server({localStt:false,transcribe:async()=>""});
  const port=await listen(s);
  const browser=await launch(["--autoplay-policy=no-user-gesture-required"]);
  if(!browser)console.log("voice-wake: browser test skipped (no browser)");
  else try{
    const tab=await browser.newPage();
    // A stand-in for Chrome/Edge speech recognition: it says what a person said, in order, as long as nobody stops it.
    // (a plain script string: the test compiler must not rewrite it)
    await tab.addInitScript(`
      window.__sr={started:0,aborted:0};
      function FakeSR(){this.continuous=false;this.interimResults=false;this.lang="";this.maxAlternatives=1;this.dead=false;this.timers=[];}
      FakeSR.prototype.start=function(){var self=this;window.__sr.started++;var session=window.__sr.started;setTimeout(function(){if(self.onstart)self.onstart()},10);
        if(session!==1)return; // only the first session hears the person; later ones hear nothing
        var results=[];
        function say(text,at,isFinal){self.timers.push(setTimeout(function(){if(self.dead)return;var r=[{transcript:text}];r.isFinal=isFinal;results.push(r);if(self.onresult)self.onresult({resultIndex:results.length-1,results:results})},at))}
        say("ليان",300,false);say("ليان",600,true);say("افتح",1200,false);say(" افتح المتصفح",1700,true)};
      FakeSR.prototype.abort=function(){var self=this;this.dead=true;window.__sr.aborted++;this.timers.forEach(clearTimeout);setTimeout(function(){if(self.onend)self.onend()},5)};
      FakeSR.prototype.stop=FakeSR.prototype.abort;
      window.SpeechRecognition=FakeSR;window.webkitSpeechRecognition=FakeSR;
    `);
    await tab.goto(`http://127.0.0.1:${port}/voice?listen=1`);
    await until(()=>seen.assistant.length>0,8000);
    assert.deepEqual(seen.assistant,["افتح المتصفح"],"the command after the name reached the assistant: "+JSON.stringify(seen)+" "+JSON.stringify(await tab.evaluate(()=>(window as any).__sr)));
    // The command is passed on exactly as heard: hamza, punctuation, numbers and links intact.
    const cases:Array<[string,string|null]>=[["ليان، افتح google.com","افتح google.com"],["يا ليان أعطني تقرير اليوم","أعطني تقرير اليوم"],["ليانْ","" ],["جارفيس: اضبط منبه 7:30","اضبط منبه 7:30"],
      ["لايان اكس شغّل الموسيقى","شغّل الموسيقى"],["LAYAN open the site","open the site"],["مرحبا كيف حالك",null]];
    const got=await tab.evaluate((list:Array<[string,string|null]>)=>list.map(([x])=>(window as any).__layanx.afterWake(x)),cases);
    assert.deepEqual(got,cases.map(([,y])=>y));
    console.log("voice-wake: browser recognition kept the session open after the name and took the next sentence as the command");
  }finally{await browser.close();}
  s.close();
}
console.log("voice-wake: the command after «ليان» is never lost");
process.exit(0);
