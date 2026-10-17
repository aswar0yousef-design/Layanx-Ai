/** Shared by the voice page tests: a fake microphone recording, measuring a clip, a browser. */

/** A WAV of silence and voice-like sound (a 140 Hz voice with harmonics and syllable-like loudness); [seconds, voiced, loudness 0-1]. */
export function voiceWav(parts:Array<[number,boolean,number?]>,rate=48000):Buffer{
  const total=parts.reduce((a,[sec])=>a+Math.round(sec*rate),0);const out=Buffer.alloc(44+total*2);let i=0;
  out.write("RIFF",0,"ascii");out.writeUInt32LE(36+total*2,4);out.write("WAVE",8,"ascii");out.write("fmt ",12,"ascii");out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write("data",36,"ascii");out.writeUInt32LE(total*2,40);
  for(const [sec,voiced,gain=1] of parts)for(let k=0;k<Math.round(sec*rate);k++,i++){const t=i/rate;
    const v=voiced?gain*(0.3*Math.sin(2*Math.PI*140*t)+0.2*Math.sin(2*Math.PI*280*t)+0.1*Math.sin(2*Math.PI*420*t))*(0.6+0.4*Math.abs(Math.sin(2*Math.PI*3*t))):0;
    out.writeInt16LE(Math.round(v*32767),44+i*2);}
  return out;
}
export const durationOf=(w:Buffer)=>(w.length-44)/2/w.readUInt32LE(24);
/** 50 ms windows of a clip: true where there is sound. */
function windows(w:Buffer):boolean[]{
  const rate=w.readUInt32LE(24),win=Math.round(rate*0.05),out:boolean[]=[];
  for(let o=44;o+win*2<=w.length;o+=win*2){let sum=0;for(let i=0;i<win;i++){const v=w.readInt16LE(o+i*2)/32768;sum+=v*v;}out.push(Math.sqrt(sum/win)>0.02);}
  return out;
}
/** Seconds of sound in a clip. */
export const voicedSeconds=(w:Buffer)=>windows(w).filter(Boolean).length*0.05;
/** Seconds of quiet before the first sound (the audio kept from before speech started). */
export const leadingQuiet=(w:Buffer)=>{const x=windows(w).indexOf(true);return(x<0?windows(w).length:x)*0.05;};

let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
export async function launchBrowser(args:string[]):Promise<any>{
  const chromium=pw?.chromium??pw?.default?.chromium;if(!chromium)return null;
  for(const a of [...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),{channel:"msedge"},{channel:"chrome"}]){try{return await chromium.launch({headless:true,args,...a});}catch{}}
  return null;
}
export const until=async(f:()=>Promise<boolean>|boolean,ms:number)=>{const end=Date.now()+ms;while(!(await f())&&Date.now()<end)await new Promise(r=>setTimeout(r,100));};
export const FAKE_MIC=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"];
