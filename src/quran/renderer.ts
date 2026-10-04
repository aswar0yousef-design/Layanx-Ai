import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {spawn} from "node:child_process";
import type {QuranSegment} from "./publisher.js";
export interface QuranRenderOptions{outputPath:string;backgroundPath?:string;fontFile?:string;fontName?:string;translation?:boolean;creditText?:string;}
export interface QuranRenderResult{outputPath:string;durationSec:number;width:1080;height:1920;}
const safe=(s:string)=>s.replace(/[\\/:*?"<>|]/g,"_");
const assTime=(seconds:number)=>{const cs=Math.round(seconds*100);const h=Math.floor(cs/360000);const m=Math.floor((cs%360000)/6000);const s=Math.floor((cs%6000)/100);const c=cs%100;return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(c).padStart(2,"0")}`;};
function assEscape(s:string){return s.replace(/\\/g,"\\\\").replace(/\{/g,"\\{").replace(/\}/g,"\\}").replace(/\r?\n/g,"\\N");}
function run(command:string,args:string[],timeout=300000){return new Promise<void>((resolve,reject)=>{const p=spawn(command,args,{stdio:["ignore","pipe","pipe"]});let err="";const timer=setTimeout(()=>{p.kill("SIGKILL");reject(new Error("quran_renderer_timeout"));},timeout);p.stderr.on("data",d=>{err+=String(d).slice(-5000);});p.on("error",e=>{clearTimeout(timer);reject(e);});p.on("close",code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error("quran_renderer_failed:"+code+":"+err.slice(-1500)));});});}
export class QuranRenderer{
 constructor(private readonly ffmpeg=process.env.LAYANX_FFMPEG_PATH??"ffmpeg"){}
 async render(segment:QuranSegment,options:QuranRenderOptions):Promise<QuranRenderResult>{
  if(segment.durationSec<30||segment.durationSec>60)throw new Error("quran_render_duration_out_of_range");
  if(!segment.verses.length)throw new Error("quran_render_empty_segment");
  const out=resolve(options.outputPath);mkdirSync(dirname(out),{recursive:true});
  const work=dirname(out);const list=resolve(work,"quran-audio-list.txt");const ass=resolve(work,"quran-subtitles.ass");
  const audioLines=segment.verses.map(v=>`file '${resolve(v.audioPath??"").replace(/'/g,"'\\''")}'`).join("\n");if(segment.verses.some(v=>!v.audioPath||!existsSync(v.audioPath)))throw new Error("quran_render_audio_missing");
  writeFileSync(list,audioLines+"\n","utf8");
  let t=0;const events:string[]=[];for(const v of segment.verses){const end=t+v.recitationDurationSec;events.push(`Dialogue: 0,${assTime(t)},${assTime(end)},Quran,,0,0,0,,${assEscape(v.arabic)}`);if(options.translation&&v.translation)events.push(`Dialogue: 0,${assTime(t)},${assTime(end)},Translation,,0,0,0,,${assEscape(v.translation.replace(/<[^>]+>/g,""))}`);t=end;}
  if(options.creditText)events.push(`Dialogue: 0,${assTime(Math.max(0,t-4))},${assTime(t)},Credit,,0,0,0,,${assEscape(options.creditText)}`);
  const assText=`[Script Info]\\nScriptType: v4.00+\\nPlayResX: 1080\\nPlayResY: 1920\\n[V4+ Styles]\\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\\nStyle: Quran,${options.fontName??"Amiri"},58,&H00FFFFFF,&H00FFFFFF,&H00101010,&H70000000,0,0,0,0,100,100,0,0,1,3,1,5,60,60,300,1\\nStyle: Translation,${options.fontName??"Amiri"},34,&H00E8E8E8,&H00E8E8E8,&H00101010,&H70000000,0,0,0,0,100,100,0,0,1,2,1,2,70,70,170,1\\nStyle: Credit,${options.fontName??"Amiri"},24,&H00FFFFFF,&H00FFFFFF,&H00101010,&H70000000,0,0,0,0,100,100,0,0,1,2,1,2,50,50,70,1\\n[Events]\\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\\n${events.join("\\n")}\\n`;
  writeFileSync(ass,assText,"utf8");
  const args=["-f","concat","-safe","0","-i",list];
  if(options.backgroundPath){if(!existsSync(options.backgroundPath))throw new Error("quran_background_missing");args.push("-loop","1","-i",resolve(options.backgroundPath));}
  const videoInput=options.backgroundPath?"1":"-1";const filter=options.backgroundPath?`[${videoInput}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles='${ass.replace(/'/g,"\\'")}'[v]`:`color=c=black:s=1080x1920:r=30,subtitles='${ass.replace(/'/g,"\\'")}'[v]`;
  args.push("-filter_complex",filter,"-map","[v]","-map","0:a","-c:v","libx264","-preset",process.env.LAYANX_QURAN_X264_PRESET??"medium","-crf",process.env.LAYANX_QURAN_X264_CRF??"22","-c:a","aac","-b:a","128k","-pix_fmt","yuv420p","-shortest","-movflags","+faststart","-y",out);
  await run(this.ffmpeg,args);return{outputPath:out,durationSec:segment.durationSec,width:1080,height:1920};
 }
 async doctor(){return new Promise<boolean>(resolve=>{const p=spawn(this.ffmpeg,["-version"],{stdio:"ignore"});p.on("error",()=>resolve(false));p.on("close",c=>resolve(c===0));});}
}
