import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {voiceUiHtml} from "../src/voice/ui.js";
import {FAKE_MIC,durationOf,launchBrowser,leadingQuiet,until,voiceWav,voicedSeconds} from "./helpers/voice-page.js";

/**
 * The owner: "it cuts me off quickly, does not hear the whole sentence, and when I interrupt it, it
 * should listen". Checked in Chromium with a fake microphone:
 *  1. local speech-to-text: a 1 s pause inside a request does not split it, and the first syllable is kept;
 *     the name said alone (short, and spelled its own way by the model) is still heard as the name;
 *  2. browser recognizer: sentences said with short pauses go out as one request (after the name, and
 *     after a tap on the circle);
 *  3. interrupting a spoken reply (local speech-to-text): it stops talking, and the command is heard from
 *     its first syllable;
 *  4. interrupting a spoken reply (browser recognizer, listening all the time): it stops and listens;
 *  5. its own voice coming back through the microphone (echo) does not interrupt it, even with loud speakers.
 */
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"lx-listen-"));
const micFile=(name:string,parts:Array<[number,boolean,number?]>)=>{const f=path.join(tmp,name+".wav");fs.writeFileSync(f,voiceWav(parts));return f;};
const REPLY="حسناً، هذا تقرير اليوم";
// An 8 s spoken reply that starts quietly (0.3 s), like Piper's: long enough to be interrupted.
const LONG_REPLY=voiceWav([[0.3,false],[7.7,true]],16000);

function serve(o:{localStt:boolean;transcribe?:(clip:Buffer,n:number)=>string;replyDuration?:number}){
  const seen={assistant:[] as string[],clips:[] as Buffer[],speak:0,earlyPause:0,played:0,
    /** When the second request arrived: had the first reply started playing, and was it stopped early? */
    atSecond:null as null|{played:number;earlyPause:number}};
  const s=http.createServer((req,res)=>{const c:Buffer[]=[];req.on("data",x=>c.push(x));req.on("end",()=>{const body=Buffer.concat(c);const send=(d:unknown)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(d));};
    if(req.url?.startsWith("/voice")){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(voiceUiHtml());return;}
    if(req.url==="/v1/voice/status")return send({ok:true,voice:{enabled:false,...(o.localStt?{stt:"local",localStt:{baseUrl:"x",model:"w"}}:{stt:"none"}),tts:"local"}});
    if(req.url==="/v1/voice/transcribe"){seen.clips.push(body);return send({ok:true,text:o.transcribe?.(body,seen.clips.length)??""});}
    if(req.url==="/v1/assistant/turn"){seen.assistant.push(JSON.parse(body.toString()).text);if(seen.assistant.length===2)seen.atSecond={played:seen.played,earlyPause:seen.earlyPause};return send({ok:true,reply:REPLY,lang:"ar"});}
    if(req.url==="/v1/voice/speak"){seen.speak++;res.writeHead(200,{"content-type":"audio/wav"});res.end(o.replyDuration?voiceWav([[0.3,false],[o.replyDuration-0.3,true]],16000):LONG_REPLY);return;}
    if(req.url==="/v1/assistant/briefing")return send({ok:true,briefing:null});
    if(req.url==="/__paused?early=true"){seen.earlyPause++;return send({ok:true});}
    if(req.url==="/__played"){seen.played++;return send({ok:true});}
    res.writeHead(404);res.end("{}");});});
  return{s,seen};
}
// Reports a reply stopped before its end (plain script: the test compiler must not rewrite it).
const SPY=`var _play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){var p=_play.call(this);p.then(function(){fetch("/__played",{method:"POST"})},function(){});return p};
 var _pause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(){var early=this.duration>0&&this.currentTime<this.duration-0.3&&!this.ended;
 if(early)fetch("/__paused?early=true",{method:"POST"});return _pause.call(this)};`;
const QUIET=`try{localStorage.setItem("lx.speak","0")}catch(e){}`;
// Without the 8 s follow-up, a sentence said during a reply can only be heard by interrupting it.
const NO_FOLLOW=`try{localStorage.setItem("lx.follow","0")}catch(e){}`;
/** The reply was interrupted: if it had started playing by then, it was stopped before its end (it may also not have started yet on a slow PC). */
const stoppedEarly=(seen:{atSecond:null|{played:number;earlyPause:number}})=>!!seen.atSecond&&(seen.atSecond.played===0||seen.atSecond.earlyPause>=1);
/**
 * A real echo: whatever the page plays comes back into its microphone at this loudness, at the same
 * moment (0.15 = what is left after the browser's echo cancellation, 0.5 = loud speakers).
 */
const echo=(gain:number)=>`(function(){
 // Chromium gives sound only to an element's first captureStream(): the page and this echo share one.
 var cs=HTMLMediaElement.prototype.captureStream;HTMLMediaElement.prototype.captureStream=function(){return this.__cs||(this.__cs=cs.call(this))};
 var gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=function(c){return gum(c).then(function(real){var ctx=new AudioContext(),dst=ctx.createMediaStreamDestination();ctx.createMediaStreamSource(real).connect(dst);
  var play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){var el=this,p=play.call(el);
   p.then(function(){try{var g=ctx.createGain();g.gain.value=${gain};ctx.createMediaStreamSource(el.captureStream()).connect(g);g.connect(dst)}catch(e){}},function(){});return p};
  return dst.stream})}})();`;
/** A stand-in for the browser recognizer: session n says what script[n] lists, at the given times (ms). */
const fakeSR=(script:Record<number,Array<[string,number,boolean]>>)=>`window.__sr=${JSON.stringify(script)};window.__srN=0;
 function FakeSR(){this.dead=false;this.timers=[]}
 FakeSR.prototype.start=function(){var self=this,n=++window.__srN,said=window.__sr[n]||[],results=[];setTimeout(function(){self.onstart&&self.onstart()},5);
  said.forEach(function(x){self.timers.push(setTimeout(function(){if(self.dead)return;var r=[{transcript:x[0]}];r.isFinal=x[2];
   if(results.length&&!results[results.length-1].isFinal)results[results.length-1]=r;else results.push(r);
   self.onresult&&self.onresult({resultIndex:results.length-1,results:results})},x[1]))})};
 FakeSR.prototype.abort=function(){var self=this;if(this.dead)return;this.dead=true;this.timers.forEach(clearTimeout);setTimeout(function(){self.onend&&self.onend()},5)};
 FakeSR.prototype.stop=FakeSR.prototype.abort;window.SpeechRecognition=FakeSR;window.webkitSpeechRecognition=FakeSR;`;

async function scenario(name:string,o:{localStt:boolean;args:string[];init:string;path:string;replyDuration?:number;transcribe?:(clip:Buffer,n:number)=>string;act?:(tab:any)=>Promise<void>;check:(seen:ReturnType<typeof serve>["seen"])=>Promise<void>}){
  const {s,seen}=serve(o);await new Promise<void>(r=>s.listen(0,"127.0.0.1",()=>r()));
  const browser=await launchBrowser(o.args);
  if(!browser){console.log("voice-listen: "+name+" skipped (no browser)");s.close();return;}
  try{
    const tab=await browser.newPage();const errors:string[]=[];tab.on("pageerror",(e:any)=>errors.push(String(e)));
    await tab.addInitScript(SPY+o.init);
    await tab.goto(`http://127.0.0.1:${(s.address() as {port:number}).port}${o.path}`);
    if(o.act)await o.act(tab);
    await o.check(seen);
    assert.deepEqual(errors,[]);
    console.log("voice-listen: "+name);
  }finally{await browser.close();s.close();}
}

// 1. Local speech-to-text: "Layan, open the browser … (1 s pause) … and look up memory prices".
{
  const f=micFile("pause",[[2.5,false],[1.2,true],[1.0,false],[1.2,true],[9,false]]);
  await scenario("local speech-to-text: a 1 s pause stays inside the request, the first syllable is kept",{localStt:true,args:[...FAKE_MIC,`--use-file-for-fake-audio-capture=${f}`],init:QUIET,path:"/voice?listen=1",
    // A clip with both parts is the whole sentence; a cut clip is only its first half.
    transcribe:clip=>voicedSeconds(clip)>=2.2?"ليان افتح المتصفح وابحث عن أسعار الذاكرة":"ليان افتح المتصفح",
    check:async seen=>{await until(()=>seen.assistant.length>0,15000);await new Promise(r=>setTimeout(r,1500));
      assert.deepEqual(seen.assistant,["افتح المتصفح وابحث عن أسعار الذاكرة"],"one request with both parts: "+JSON.stringify(seen.clips.map(c=>[durationOf(c),voicedSeconds(c)])));
      assert.ok(leadingQuiet(seen.clips[0]!)>=0.35,"the 0.5 s before speech is kept: "+leadingQuiet(seen.clips[0]!));}});
}

// 1b. The name alone, a pause, then the sentence: the short name clip is sent, so the sentence is the command.
{
  const f=micFile("name",[[2.5,false],[0.4,true],[1.6,false],[1.4,true],[9,false]]);
  await scenario("local speech-to-text: «Layan» alone (0.4 s), then «hello, how are you»: answered",{localStt:true,args:[...FAKE_MIC,`--use-file-for-fake-audio-capture=${f}`],init:QUIET,path:"/voice?listen=1",
    // A real model writes a lone name its own way. (Dropping the short name clip made the sentence clip 1.)
    transcribe:(_clip,n)=>n===1?"إليان.":"مرحباً كيف حالك؟",
    check:async seen=>{await until(()=>seen.assistant.length>0,15000);
      assert.deepEqual(seen.assistant,["مرحباً كيف حالك؟"],JSON.stringify(seen.clips.map(c=>voicedSeconds(c))));}});
}

// 2a. Browser recognizer after the name: two sentences with a short pause are one request.
await scenario("browser recognizer: sentences after the name are joined into one request",{localStt:false,args:FAKE_MIC,path:"/voice?listen=1",
  init:QUIET+fakeSR({1:[["ليان افتح المتصفح",600,true],["وابحث",1300,false],["وابحث عن أسعار الذاكرة",1900,true]]}),
  check:async seen=>{await until(()=>seen.assistant.length>0,8000);await new Promise(r=>setTimeout(r,1500));
    assert.deepEqual(seen.assistant,["افتح المتصفح وابحث عن أسعار الذاكرة"]);}});
// 2b. A tap on the circle, then two sentences.
await scenario("browser recognizer: after a tap, the whole request is heard, not only its first sentence",{localStt:false,args:FAKE_MIC,path:"/voice",
  init:QUIET+fakeSR({1:[["افتح المتصفح",500,true],["ثم ابحث عن الطقس",1400,true]]}),
  act:async tab=>{await tab.waitForTimeout(300);await tab.click("#orb");},
  check:async seen=>{await until(()=>seen.assistant.length>0,8000);await new Promise(r=>setTimeout(r,1500));
    assert.deepEqual(seen.assistant,["افتح المتصفح ثم ابحث عن الطقس"]);}});

// 3. Local speech-to-text: the request, the reply starts, the owner talks over it.
{
  // Leave enough time for the first reply to start even on slow Windows CI before the second fake utterance.
  const f=micFile("barge-local",[[2.5,false],[1.4,true],[4.2,false],[1.8,true],[12,false]]);
  await scenario("interrupting with local speech-to-text: stops talking and hears the command from its start (with echo)",{localStt:true,args:[...FAKE_MIC,`--use-file-for-fake-audio-capture=${f}`],init:NO_FOLLOW+echo(0.15),path:"/voice?listen=1",replyDuration:14,
    transcribe:(clip,n)=>n===1?"ليان أعطني تقرير اليوم":voicedSeconds(clip)>=1.35?"اعرض الطقس بدلاً من ذلك":"الطقس",
    check:async seen=>{await until(()=>seen.assistant.length>1,26000);
      assert.deepEqual(seen.assistant.slice(0,2),["أعطني تقرير اليوم","اعرض الطقس بدلاً من ذلك"],JSON.stringify(seen.clips.map(c=>voicedSeconds(c))));
      assert.ok(stoppedEarly(seen),"the reply stopped before its end: "+JSON.stringify(seen.atSecond));}});
}

// 4. Browser recognizer, listening all the time: the owner talks over the reply.
{
  const f=micFile("barge-browser",[[4.5,false],[1.5,true],[14,false]]);
  await scenario("interrupting with the browser recognizer: stops talking and listens (with echo)",{localStt:false,args:[...FAKE_MIC,`--use-file-for-fake-audio-capture=${f}`],path:"/voice?listen=1",
    init:NO_FOLLOW+echo(0.15)+fakeSR({1:[["ليان أعطني تقرير اليوم",400,true]],2:[["اعرض الطقس بدلاً من ذلك",500,true]]}),
    check:async seen=>{await until(()=>seen.assistant.length>1,15000);
      assert.deepEqual(seen.assistant.slice(0,2),["أعطني تقرير اليوم","اعرض الطقس بدلاً من ذلك"]);
      assert.ok(stoppedEarly(seen),"the reply stopped before its end: "+JSON.stringify(seen.atSecond));}});
}
// 5. Its own voice comes back through the microphone (after echo cancellation, and with loud speakers):
//    the reply is not interrupted by it, also though the reply starts quietly.
for(const gain of [0.15,0.5]){
  const f=micFile("echo"+gain,[[2.5,false],[1.4,true],[14,false]]);
  await scenario(`its own voice in the microphone (echo ${gain}) does not interrupt the reply`,{localStt:true,args:[...FAKE_MIC,`--use-file-for-fake-audio-capture=${f}`],init:echo(gain),path:"/voice?listen=1",
    transcribe:(_clip,n)=>n===1?"ليان أعطني تقرير اليوم":"",
    check:async seen=>{await until(()=>seen.speak>0,15000);await new Promise(r=>setTimeout(r,9000));
      assert.equal(seen.earlyPause,0,"the reply was not cut by its own echo");
      assert.deepEqual(seen.assistant,["أعطني تقرير اليوم"]);}});
}
fs.rmSync(tmp,{recursive:true,force:true});
console.log("voice-listen: whole requests are heard, and talking over a reply interrupts it");
process.exit(0);
