import assert from "node:assert/strict";
import http from "node:http";
import {LocalSpeaker,VoiceService,type VoiceProvider} from "../src/voice/service.js";

// A fake Piper http_server: POST /synthesize {text, voice} -> WAV; it only knows the Arabic voice.
const seen:any[]=[];
const server=http.createServer((req,res)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{
  const b=JSON.parse(body||"{}");seen.push(b);
  if(b.voice&&b.voice!=="ar_JO-kareem-medium"){res.writeHead(404);res.end("voice not found");return;}
  const wav=Buffer.alloc(2000);wav.write("RIFF",0,"ascii");res.writeHead(200,{"content-type":"audio/wav"});res.end(wav);});});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
const url=`http://127.0.0.1:${(server.address() as any).port}`;
try{
  const speaker=new LocalSpeaker(url,{});
  assert.equal(speaker.voiceFor("مرحبا بك"),"ar_JO-kareem-medium");
  assert.equal(speaker.voiceFor("Hello there"),"en_US-lessac-medium");
  assert.equal(speaker.voiceFor("Hello","ar"),"ar_JO-kareem-medium","explicit language wins");
  const ar=await speaker.speak("مرحبا");
  assert.equal(ar.contentType,"audio/wav");assert.equal(seen.at(-1).voice,"ar_JO-kareem-medium");
  await speaker.speak("Hello","en");
  assert.deepEqual(seen.slice(-2).map(b=>b.voice),["en_US-lessac-medium",undefined],"unknown voice -> retry with the server's default voice");

  // VoiceService: Piper first; the cloud voice only as a fallback; status tells the page which engine speaks.
  let cloudCalls=0;
  const cloud:VoiceProvider={name:"openai",status:()=>({enabled:true,provider:"openai",transcriptionModel:"x",speechModel:"y",voice:"z"}),
    async transcribe(){return"";},async speak(){cloudCalls++;return{audio:Buffer.from("mp3"),contentType:"audio/mpeg"};}};
  const service=new VoiceService(cloud,null,speaker);
  assert.equal(service.status().tts,"local");
  assert.equal((await service.speak("مرحبا","mp3","ar")).contentType,"audio/wav");assert.equal(cloudCalls,0);
  const broken=new VoiceService(cloud,null,new LocalSpeaker("http://127.0.0.1:9",{}));
  assert.equal((await broken.speak("hi","mp3")).contentType,"audio/mpeg","Piper down -> cloud voice");
  const offline=new VoiceService({...cloud,status:()=>({enabled:false,provider:"openai",transcriptionModel:"x",speechModel:"y",voice:"z"})},null,null);
  assert.equal(offline.status().tts,"browser","no engine -> the page speaks with the browser");
}finally{server.close();}
console.log("voice-local-tts: Piper voice choice, fallback and engine status verified");
