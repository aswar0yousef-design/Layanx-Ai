import {createHash} from "node:crypto";
import {existsSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {QuranPublisher,QuranVerse,QuranSegment} from "./publisher.js";
import {QuranFoundationSource,QuranSourceConfig} from "./source.js";
import {QuranRightsCatalog} from "./rights.js";
import {QuranRenderer,QuranRenderOptions} from "./renderer.js";
export interface QuranPipelineConfig extends QuranSourceConfig{outputDir:string;platforms:string[];backgroundPath?:string;fontFile?:string;fontName?:string;translationLanguage?:string;translationId?:number;}
export interface QuranPipelineResult{segment:QuranSegment;videoPath:string;idempotencyKey:string;creditText:string;readyForPublication:boolean;}
export class QuranPipeline{
 constructor(private readonly config:QuranPipelineConfig,private readonly rights:QuranRightsCatalog,private readonly source=new QuranFoundationSource(config),private readonly publisher=new QuranPublisher(),private readonly renderer=new QuranRenderer()){}
 async prepare(surah:number,startAyah?:number):Promise<QuranPipelineResult>{
  const license=this.rights.assertPublishable(this.config.recitationId,this.config.platforms);
  const verses=await this.source.chapter(surah);
  const hydrated:QuranVerse[]=[];for(const v of verses){if(startAyah&&v.ayah<startAyah)continue;const audioPath=resolve(this.config.outputDir,"audio",v.verseKey.replace(":","-")+".mp3");mkdirSync(join(this.config.outputDir,"audio"),{recursive:true});if(!existsSync(audioPath)){const response=await fetch(v.audioUrl);if(!response.ok)throw new Error("quran_audio_download_http_"+response.status);writeFileSync(audioPath,Buffer.from(await response.arrayBuffer()));}hydrated.push({surah:v.surah,ayah:v.ayah,arabic:v.arabic,translation:v.translation,recitationDurationSec:await this.probeDuration(audioPath),audioPath});if(hydrated.length>=20)break;}
  const segment=this.publisher.planSegment(hydrated);const idempotencyKey=createHash("sha256").update(`quran-video:${segment.surah}:${segment.fromAyah}:${segment.toAyah}:${this.config.recitationId}`).digest("hex").slice(0,24);
  const out=join(this.config.outputDir,"videos",`surah-${segment.surah}-${segment.fromAyah}-${segment.toAyah}.mp4`);
  const renderOptions:QuranRenderOptions={outputPath:out,backgroundPath:this.config.backgroundPath,fontFile:this.config.fontFile,fontName:this.config.fontName,translation:true,creditText:license.creditText};
  await this.renderer.render(segment,renderOptions);
  return{segment,videoPath:out,idempotencyKey,creditText:license.creditText,readyForPublication:true};
 }
 private async probeDuration(path:string){return new Promise<number>((resolveResult,reject)=>{const {spawn}=require("node:child_process") as typeof import("node:child_process");const ffprobe=process.env.LAYANX_FFPROBE_PATH??"ffprobe";const p=spawn(ffprobe,["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",path],{stdio:["ignore","pipe","ignore"]});let out="";p.stdout.on("data",d=>out+=String(d));p.on("error",()=>reject(new Error("quran_ffprobe_not_available")));p.on("close",code=>{if(code!==0)reject(new Error("quran_ffprobe_failed"));else{const n=Number(out.trim());if(!Number.isFinite(n)||n<=0)reject(new Error("quran_audio_duration_invalid"));else resolveResult(n);}});});}
}
