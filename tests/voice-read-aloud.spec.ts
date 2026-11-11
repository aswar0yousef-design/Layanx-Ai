import assert from "node:assert/strict";
import http from "node:http";
import {voiceUiHtml} from "../src/voice/ui.js";
import {splitForSpeech} from "../src/voice/speech-text.js";
import {launchBrowser,until} from "./helpers/voice-page.js";

/**
 * Written text is read to its end, in a real browser. The page is the real assistant page and the segments come from
 * the real splitter; only the speech engine is replaced.
 */
const sentenceAr=(n:number)=>`الجملة العربية رقم ${n} تصف ما تم إنجازه في المشروع حتى الآن.`;
const sentenceEn=(n:number)=>`English sentence number ${n} describes the work that remains.`;
const LONG=Array.from({length:30},(_,i)=>i%3===2?sentenceEn(i):sentenceAr(i)).join(" ");
const expected=splitForSpeech(LONG,"ar");
assert.equal(expected.length,30);

const wavOf=(seconds:number)=>{const n=Math.round(16000*seconds),b=Buffer.alloc(44+n*2);b.write("RIFF",0,"ascii");b.writeUInt32LE(36+n*2,4);b.write("WAVE",8,"ascii");b.write("fmt ",12,"ascii");b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36,"ascii");b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(6000*Math.sin(i/8)),44+i*2);return b;};
const clip=wavOf(0.2);

function serve(o:{tts:"local"|"browser";failFrom?:number;synthMs?:number}){
  const seen={speak:[] as Array<{text:string;lang:string}>};
  const s=http.createServer((req,res)=>{const c:Buffer[]=[];req.on("data",x=>c.push(x));req.on("end",()=>{const raw=Buffer.concat(c).toString();const send=(d:unknown)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(d));};
    if(req.url?.startsWith("/voice")){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(voiceUiHtml());return;}
    if(req.url==="/v1/voice/status")return send({ok:true,voice:{enabled:false,stt:"none",tts:o.tts}});
    if(req.url==="/v1/assistant/briefing")return send({ok:true,briefing:null});
    if(req.url==="/v1/assistant/turn")return send({ok:true,reply:LONG,lang:"ar"});
    if(req.url==="/v1/voice/prepare"){const b=JSON.parse(raw);return send({ok:true,segments:splitForSpeech(b.text,b.lang)});}
    if(req.url==="/v1/voice/speak"){const b=JSON.parse(raw);seen.speak.push({text:b.text,lang:b.lang});
      if(o.failFrom!==undefined&&expected.findIndex(e=>e.text===b.text)>=o.failFrom){res.writeHead(500);res.end("{}");return;}
      setTimeout(()=>{res.writeHead(200,{"content-type":"audio/wav"});res.end(clip);},o.synthMs??30);return;}
    res.writeHead(404);res.end("{}");});});
  return{s,seen};
}
// What really played, and when. Plain script: the test compiler must not rewrite it.
const SPY=`window.__t={plays:0,ended:0,playing:[],endedAt:[]};var _p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){var el=this;window.__t.plays++;
 el.addEventListener("playing",function(){window.__t.playing.push(performance.now())},{once:true});el.addEventListener("ended",function(){window.__t.ended++;window.__t.endedAt.push(performance.now())},{once:true});return _p.call(el)};`;
// Replaces the browser's speech engine: each utterance "ends" after 20 ms.
const FAKE_SPEECH=`window.__u=[];(function(){var q=[],busy=false;function run(){if(busy||!q.length)return;busy=true;var u=q.shift();window.__u.push({text:u.text,lang:u.lang});setTimeout(function(){busy=false;if(u.onend)u.onend({});run()},20)}
 window.SpeechSynthesisUtterance=function(t){this.text=t};Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{getVoices:function(){return[]},speak:function(u){q.push(u);run()},cancel:function(){q=[]},get speaking(){return busy},get pending(){return q.length>0},onvoiceschanged:null}})})();`;

async function scenario(name:string,o:{tts:"local"|"browser";failFrom?:number;synthMs?:number;init?:string},run:(tab:any,seen:any)=>Promise<void>){
  const {s,seen}=serve(o);await new Promise<void>(r=>s.listen(0,"127.0.0.1",()=>r()));
  const browser=await launchBrowser([]);
  if(!browser){console.log("voice-read-aloud: "+name+" skipped (no browser)");s.close();return;}
  try{
    const tab=await browser.newPage();const errors:string[]=[];tab.on("pageerror",(e:any)=>errors.push(String(e)));
    await tab.addInitScript(SPY+(o.init??""));
    await tab.goto(`http://127.0.0.1:${(s.address() as {port:number}).port}/voice`);
    await run(tab,seen);
    assert.deepEqual(errors,[]);
    console.log("voice-read-aloud: "+name);
  }finally{await browser.close();s.close();}
}
const trace=(tab:any)=>tab.evaluate("window.__t");
const ask=async(tab:any)=>{await tab.fill("#sayInput","أعطني تقرير اليوم");await tab.click("#sendBtn");};

await scenario("a long reply is read to the end, in order, each sentence in its own language",{tts:"local"},async(tab,seen)=>{
  await ask(tab);
  await until(async()=>(await trace(tab)).ended>=expected.length,25000);
  const t=await trace(tab);
  assert.equal(t.ended,expected.length,"every sentence played once");
  // Sentences are requested ahead of playback and may arrive at the server out of order; none is missing or repeated.
  assert.deepEqual([...seen.speak].map((p:any)=>p.text+"|"+p.lang).sort(),expected.map(e=>e.text+"|"+e.lang).sort());
  // The next sentence is ready when the previous ends: the wait is the pause plus the time a media element takes to start.
  const gaps=t.playing.slice(1).map((at:number,i:number)=>at-t.endedAt[i]);
  assert.ok(Math.max(...gaps)<600,"longest gap "+Math.round(Math.max(...gaps))+" ms");
  console.log("voice-read-aloud: gaps between sentences (ms) median "+Math.round([...gaps].sort((a,b)=>a-b)[gaps.length>>1])+", longest "+Math.round(Math.max(...gaps)));
});

await scenario("sound starts with the first sentence, before the rest is made",{tts:"local",synthMs:400},async(tab,seen)=>{
  await ask(tab);
  await until(async()=>(await trace(tab)).playing.length>0,8000);
  assert.ok(seen.speak.length<=4,"only the sentences just ahead were requested: "+seen.speak.length);
  await tab.click("#stopBtn");
});

await scenario("the read button reads a reply even with spoken replies off, and stop really stops",{tts:"local",synthMs:60},async(tab,seen)=>{
  await tab.evaluate("document.getElementById('speakOn').click()");
  await ask(tab);
  await tab.waitForSelector("#log li.me button.read");
  await new Promise(r=>setTimeout(r,400));
  assert.equal(seen.speak.length,0,"spoken replies are off");
  await tab.click("#log li.me button.read");
  await until(async()=>(await trace(tab)).ended>=2,8000);
  await tab.click("#stopBtn");
  await new Promise(r=>setTimeout(r,150));
  const stoppedAt=(await trace(tab)).plays;
  await new Promise(r=>setTimeout(r,1200));
  assert.equal((await trace(tab)).plays,stoppedAt,"nothing plays after stop");
  assert.ok(stoppedAt<expected.length);
});

await scenario("the read box reads whatever is written in it",{tts:"local"},async(tab,seen)=>{
  await tab.click("#l-readBox");
  await tab.fill("#readText","**مرحباً** بك في البرنامج. Hello and welcome to the program.");
  await tab.click("#readGo");
  await until(async()=>(await trace(tab)).ended>=2,8000);
  assert.deepEqual([...seen.speak].sort((a:any,b:any)=>a.lang.localeCompare(b.lang)),[{text:"مرحباً بك في البرنامج.",lang:"ar"},{text:"Hello and welcome to the program.",lang:"en"}]);
});

await scenario("if the local voice dies midway, the browser voice reads the rest",{tts:"local",failFrom:5,init:FAKE_SPEECH},async tab=>{
  await ask(tab);
  await until(async()=>(await tab.evaluate("window.__u.length"))>=expected.length-5,15000);
  const uttered:Array<{text:string}>=await tab.evaluate("window.__u");
  const t=await trace(tab);
  assert.equal(t.ended,5,"the first five played on the local voice");
  assert.deepEqual(uttered.map(u=>u.text),expected.slice(5).map(e=>e.text),"the rest continue from the exact sentence");
});

await scenario("browser voice: one utterance per sentence, each in its own language",{tts:"browser",init:FAKE_SPEECH},async tab=>{
  await ask(tab);
  await until(async()=>(await tab.evaluate("window.__u.length"))>=expected.length,15000);
  const uttered:Array<{text:string;lang:string}>=await tab.evaluate("window.__u");
  assert.deepEqual(uttered.map(u=>u.text),expected.map(e=>e.text));
  assert.deepEqual(uttered.map(u=>u.lang),expected.map(e=>e.lang==="en"?"en-US":"ar-SA"));
});

// Natural voices read several sentences in one go, so the engine places the pauses; the best Arabic voice is chosen.
const NATURAL=FAKE_SPEECH.replace("getVoices:function(){return[]}",`getVoices:function(){return[{name:"Microsoft William Online (Natural)",lang:"en-AU"},{name:"Microsoft Fatima Online (Natural)",lang:"ar-AE"},{name:"Microsoft Zariyah Online (Natural)",lang:"ar-SA"},{name:"Microsoft Ava Online (Natural)",lang:"en-US"}]}`).replace("window.__u.push({text:u.text,lang:u.lang})","window.__u.push({text:u.text,lang:u.lang,voice:u.voice&&u.voice.name})");
await scenario("natural browser voice: sentences read together, nothing lost, language order kept",{tts:"browser",init:NATURAL},async tab=>{
  await tab.click("#l-readBox");
  const arabic=Array.from({length:40},(_,i)=>sentenceAr(i)).join(" "),english=Array.from({length:3},(_,i)=>sentenceEn(i)).join(" ");
  await tab.fill("#readText",arabic+" "+english);
  await tab.click("#readGo");
  await until(async()=>{const u:Array<{text:string}>=await tab.evaluate("window.__u");return u.some(x=>x.text.includes("number 2"));},15000);
  const uttered:Array<{text:string;lang:string;voice:string}>=await tab.evaluate("window.__u");
  assert.ok(uttered.length<10,"sentences were grouped: "+uttered.length);
  assert.ok(uttered.every(u=>u.text.length<=1000));
  assert.deepEqual(uttered.map(u=>u.text).join(" ").split(/\s+/),(arabic+" "+english).split(/\s+/));
  assert.ok(uttered.filter(u=>u.lang==="ar-SA").every(u=>/Zariyah/.test(u.voice)),"the Saudi natural voice is preferred");
  assert.ok(uttered.filter(u=>u.lang==="en-US").every(u=>/Ava/.test(u.voice)));
});

console.log("voice-read-aloud: written text is read to the end without being cut");
process.exit(0);
