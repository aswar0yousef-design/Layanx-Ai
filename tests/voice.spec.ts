import {VoiceService} from "../src/voice/service.js";

const calls:{transcribe:number;speak:number}={transcribe:0,speak:0};
const provider={
 name:"test",
 status(){return{enabled:true,provider:"test",transcriptionModel:"test-stt",speechModel:"test-tts",voice:"test"};},
 async transcribe(audio:Buffer,mimeType:string,filename:string,language?:string){
  calls.transcribe++;
  if(!audio.length||mimeType!=="audio/webm"||filename!=="voice.webm"||language!=="ar")throw new Error("voice input contract failed");
  return "اختبر LayanX";
 },
 async speak(text:string){
  calls.speak++;
  if(text!=="تم")throw new Error("voice output contract failed");
  return{audio:Buffer.from("audio"),contentType:"audio/mpeg"};
 }
};

const voice=new VoiceService(provider);
const status=voice.status();
if(!status.enabled||status.provider!=="test")throw new Error("Voice provider status failed.");
const text=await voice.transcribe(Buffer.from("sample"),"audio/webm","voice.webm","ar");
if(text!=="اختبر LayanX"||calls.transcribe!==1)throw new Error("Voice transcription failed.");
const audio=await voice.speak("تم");
if(audio.contentType!=="audio/mpeg"||audio.audio.toString()!=="audio"||calls.speak!==1)throw new Error("Voice synthesis failed.");

console.log("Voice service tests passed.");
