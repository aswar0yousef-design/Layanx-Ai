import {createHash} from "node:crypto";
import {mkdirSync,rmSync,writeFileSync,readFileSync,renameSync} from "node:fs";
import {join,resolve} from "node:path";
import {spawn} from "node:child_process";
import {QuranPublisher,QuranVerse,QuranSegment,QuranPublishedSegment} from "./publisher.js";
import {QuranFoundationSource,QuranSourceConfig} from "./source.js";
import {QuranRightsCatalog} from "./rights.js";
import {QuranRenderer,QuranRenderOptions} from "./renderer.js";
import {NativeSocialConnector} from "../business/native-social.js";
import type {SocialAccount} from "../business/types.js";
export interface QuranPipelineConfig extends QuranSourceConfig{outputDir:string;platforms:string[];backgroundPath?:string;fontFile?:string;fontName?:string;translationLanguage?:string;translationId?:number;channelName?:string;}
export interface QuranPipelineResult{segment:QuranSegment;videoPath:string;idempotencyKey:string;creditText:string;readyForPublication:boolean;}
export interface QuranLedgerEntry extends QuranPublishedSegment{recitationId:number;videoPath:string;platforms:string[];idempotencyKey:string;status:"submitted"|"published"|"partial";publicationResults?:Array<{platform:string;externalId:string;status:"submitted"|"published"}>;}
export class QuranPublicationLedger{
 constructor(private readonly path:string){}
 private read():QuranLedgerEntry[]{try{return JSON.parse(readFileSync(this.path,"utf8")) as QuranLedgerEntry[];}catch{return[];}}
 private write(items:QuranLedgerEntry[]){mkdirSync(join(this.path,".."),{recursive:true});const tmp=this.path+".tmp";writeFileSync(tmp,JSON.stringify(items,null,2),"utf8");renameSync(tmp,this.path);}
 has(key:string){return this.read().some(x=>x.idempotencyKey===key);}
 find(key:string){return this.read().find(x=>x.idempotencyKey===key);}
 add(entry:QuranLedgerEntry){const items=this.read();if(items.some(x=>x.idempotencyKey===entry.idempotencyKey))return false;items.push(entry);this.write(items);return true;}
 upsert(entry:QuranLedgerEntry){const items=this.read();const index=items.findIndex(x=>x.idempotencyKey===entry.idempotencyKey);if(index<0)items.push(entry);else items[index]=entry;this.write(items);return structuredClone(entry);}
 list(){return this.read();}
}
export class QuranPipeline{
 private readonly ledger:QuranPublicationLedger;
 constructor(private readonly config:QuranPipelineConfig,private readonly rights:QuranRightsCatalog,private readonly source=new QuranFoundationSource(config),private readonly publisher=new QuranPublisher(),private readonly renderer=new QuranRenderer()){this.ledger=new QuranPublicationLedger(join(config.outputDir,"publication-ledger.json"));}
 async prepare(surah:number,startAyah?:number):Promise<QuranPipelineResult>{
  const license=this.rights.assertPublishable(this.config.recitationId,this.config.platforms);const verses=await this.source.chapter(surah);const hydrated:QuranVerse[]=[];const tempDir=join(this.config.outputDir,".audio-temp");mkdirSync(tempDir,{recursive:true});
  try{
   for(const v of verses){if(startAyah&&v.ayah<startAyah)continue;const audioPath=resolve(tempDir,v.verseKey.replace(":","-")+".mp3");const response=await fetch(v.audioUrl);if(!response.ok)throw new Error("quran_audio_download_http_"+response.status);writeFileSync(audioPath,Buffer.from(await response.arrayBuffer()));hydrated.push({surah:v.surah,ayah:v.ayah,arabic:v.arabic,translation:v.translation,recitationDurationSec:await this.probeDuration(audioPath),audioPath});if(hydrated.length>=20)break;}
   const published=this.ledger.list().map(x=>({surah:x.surah,fromAyah:x.fromAyah,toAyah:x.toAyah,durationSec:x.durationSec,publicationIds:x.publicationIds,publishedAt:x.publishedAt}));
   const segment=this.publisher.planSegment(hydrated,0,published);const idempotencyKey=createHash("sha256").update("quran-video:"+segment.surah+":"+segment.fromAyah+":"+segment.toAyah+":"+this.config.recitationId).digest("hex").slice(0,24);
   if(this.ledger.has(idempotencyKey))throw new Error("quran_video_already_published");
   const out=join(this.config.outputDir,"videos","surah-"+segment.surah+"-"+segment.fromAyah+"-"+segment.toAyah+".mp4");
   const renderOptions:QuranRenderOptions={outputPath:out,backgroundPath:this.config.backgroundPath,fontFile:this.config.fontFile,fontName:this.config.fontName,translation:true,creditText:license.creditText};await this.renderer.render(segment,renderOptions);
   return{segment,videoPath:out,idempotencyKey,creditText:license.creditText,readyForPublication:true};
  }finally{rmSync(tempDir,{recursive:true,force:true});}
 }
 async publishPrepared(result:QuranPipelineResult,accounts:Record<string,SocialAccount>){
  if(!result.readyForPublication)throw new Error("quran_video_not_ready");const license=this.rights.assertPublishable(this.config.recitationId,this.config.platforms);const existing=this.ledger.find(result.idempotencyKey);if(existing&&existing.status==="published")throw new Error("quran_video_already_published");
  const item={title:"Quran — Surah "+result.segment.surah+" • "+result.segment.fromAyah+"-"+result.segment.toAyah,body:(license.creditText+"\n\nQuran data provided by Quran Foundation.\n"+(this.config.channelName??"")).trim(),mediaUrls:[result.videoPath]};
  const entry:QuranLedgerEntry=existing??{surah:result.segment.surah,fromAyah:result.segment.fromAyah,toAyah:result.segment.toAyah,durationSec:result.segment.durationSec,publicationIds:[],publishedAt:new Date().toISOString(),recitationId:this.config.recitationId,videoPath:result.videoPath,platforms:[...this.config.platforms],idempotencyKey:result.idempotencyKey,status:"partial",publicationResults:[]};
  for(const platform of this.config.platforms){if(entry.publicationResults?.some(x=>x.platform===platform))continue;const account=accounts[platform];if(!account)throw new Error("quran_social_account_missing:"+platform);try{const published=await new NativeSocialConnector(platform as any).publish(account,item);entry.publicationIds.push(published.externalId);entry.publicationResults=[...(entry.publicationResults??[]),{platform,externalId:published.externalId,status:"submitted"}];this.ledger.upsert(entry);}catch(error){entry.status=entry.publicationResults?.length?"partial":"partial";this.ledger.upsert(entry);throw error;}}
  entry.status=entry.publicationResults?.length===this.config.platforms.length?"published":"partial";return this.ledger.upsert(entry);
 }
 private async probeDuration(path:string){return new Promise<number>((resolveResult,reject)=>{const ffprobe=process.env.LAYANX_FFPROBE_PATH??"ffprobe";const p=spawn(ffprobe,["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",path],{stdio:["ignore","pipe","ignore"]});let out="";p.stdout.on("data",d=>out+=String(d));p.on("error",()=>reject(new Error("quran_ffprobe_not_available")));p.on("close",code=>{if(code!==0)reject(new Error("quran_ffprobe_failed"));else{const n=Number(out.trim());if(!Number.isFinite(n)||n<=0)reject(new Error("quran_audio_duration_invalid"));else resolveResult(n);}});});}
}