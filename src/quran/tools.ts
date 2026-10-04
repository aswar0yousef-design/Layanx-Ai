import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {QuranPipeline,QuranPublicationLedger} from "./pipeline.js";
import {QuranRightsCatalog} from "./rights.js";
import {QURAN_AUXILIARY_SOURCES,getQuranAuxiliarySource} from "./catalog.js";
import {OAuthConnectionCenter} from "../business/oauth.js";
import type {SocialAccount} from "../business/types.js";
import {join} from "node:path";
function config(){
 const clientId=process.env.QF_CLIENT_ID??"";const clientSecret=process.env.QF_CLIENT_SECRET??"";const recitationId=Number(process.env.LAYANX_QURAN_RECITATION_ID??process.env.QF_RECITATION_ID??"0");
 return {clientId,clientSecret,environment:(process.env.QF_ENV==="production"?"production":"prelive") as "production"|"prelive",recitationId,translationId:Number(process.env.LAYANX_QURAN_TRANSLATION_ID??process.env.QF_TRANSLATION_ID??"0")||undefined,outputDir:process.env.LAYANX_QURAN_OUTPUT_DIR??".layanx/quran",platforms:(process.env.LAYANX_QURAN_PLATFORMS??"youtube,tiktok").split(",").map(x=>x.trim()).filter(Boolean),backgroundPath:process.env.LAYANX_QURAN_BACKGROUND_PATH,fontFile:process.env.LAYANX_QURAN_FONT_FILE,fontName:process.env.LAYANX_QURAN_FONT_NAME??"Amiri",channelName:process.env.LAYANX_QURAN_CHANNEL_NAME,translationLanguage:process.env.LAYANX_QURAN_TRANSLATION_LANGUAGE??"en"};
}
function pipeline(){
 const c=config();if(!c.clientId||!c.clientSecret)throw new Error("quran_foundation_credentials_not_configured");if(!c.recitationId)throw new Error("quran_recitation_id_not_configured");
 const rights=new QuranRightsCatalog();const approved=process.env.LAYANX_QURAN_LICENSE_APPROVED==="true";rights.register({recitationId:c.recitationId,reciterName:process.env.LAYANX_QURAN_RECITER_NAME??"Configured reciter",status:approved?"approved":"pending",allowedPlatforms:c.platforms,allowsSocialVideo:approved,proofUrl:process.env.LAYANX_QURAN_LICENSE_PROOF_URL,creditText:process.env.LAYANX_QURAN_RECITER_CREDIT??("Recitation: "+(process.env.LAYANX_QURAN_RECITER_NAME??"Reciter"))});
 return {c,p:new QuranPipeline(c,rights),ledger:new QuranPublicationLedger(join(c.outputDir,"publication-ledger.json"))};
}
function account(platform:string):SocialAccount{const envName=platform.toUpperCase();return{id:"quran-"+platform,platform:platform as any,name:process.env["LAYANX_QURAN_"+envName+"_ACCOUNT_NAME"]??platform,externalId:process.env["LAYANX_QURAN_"+envName+"_ACCOUNT_ID"],enabled:true,createdAt:new Date().toISOString()};}
export function registerQuranTools(core:LayanXCore){
 const defs=[["quran.doctor","check Quran source, rights, renderer and social configuration","L1_READ",false],["quran.prepare_next","prepare the next unpublished 30–60 second Quran video","L3_MODIFY",false],["quran.publish_next","prepare and publish the next Quran video to configured platforms","L4_EXECUTE",true]] as const;
 const handlers:Record<string,(p:any)=>Promise<unknown>|unknown>={
  "quran.doctor":()=>{const c=config();const ledger=new QuranPublicationLedger(join(c.outputDir,"publication-ledger.json"));return{configured:Boolean(c.clientId&&c.clientSecret&&c.recitationId),rightsApproved:process.env.LAYANX_QURAN_LICENSE_APPROVED==="true",platforms:c.platforms,ffmpegPath:process.env.LAYANX_FFMPEG_PATH??"ffmpeg",outputDir:c.outputDir,published:ledger.list().length,auxiliarySources:QURAN_AUXILIARY_SOURCES.map(source=>({id:source.id,kind:source.kind,license:source.license,status:source.status,commercialUse:source.commercialUse,audioRightsSeparate:source.audioRightsSeparate})),selectedTimingSource:getQuranAuxiliarySource(process.env.LAYANX_QURAN_TIMING_SOURCE??"qud-universal-audio")?.id??null};},
  "quran.prepare_next":async(p)=>{const x=pipeline();const surah=Number(p?.surah??process.env.LAYANX_QURAN_START_SURAH??1);const startAyah=p?.startAyah?Number(p.startAyah):undefined;return x.p.prepare(surah,startAyah);},
  "quran.publish_next":async(p)=>{const x=pipeline();let surah=Number(p?.surah??0);let startAyah=p?.startAyah?Number(p.startAyah):undefined;if(!surah){const latest=x.ledger.list().sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0];surah=latest?.surah??Number(process.env.LAYANX_QURAN_START_SURAH??1);startAyah=latest?latest.toAyah+1:undefined;}
   for(let attempt=0;attempt<114;attempt++){try{const result=await x.p.prepare(surah,startAyah);const accounts:Record<string,SocialAccount>={};for(const platform of x.c.platforms)accounts[platform]=account(platform);const oauth=new OAuthConnectionCenter();for(const platform of x.c.platforms){const id=process.env["LAYANX_QURAN_"+platform.toUpperCase()+"_OAUTH_CONNECTION_ID"];if(id){try{await oauth.token(oauth.get(id));}catch(error){throw new Error("quran_"+platform+"_oauth_refresh_failed");}}}return await x.p.publishPrepared(result,accounts);}catch(error){if(startAyah&&String(error).includes("quran_verses_required")){surah+=1;startAyah=undefined;continue;}throw error;}}throw new Error("quran_no_unpublished_surah_available");
  }
 };
 for(const [name,description,permission,dangerous] of defs){core.tools.register({name,description,permission:permission as any,dangerous,actions:[name],tags:["quran","media","publishing"]});const adapter:ToolAdapter={async execute(request){const fn=handlers[name];if(!fn)throw new Error("Unknown Quran tool");return fn(request.payload??{});}};core.toolAdapters.register(name,adapter);}
}
export function configureQuranDailySchedules(core:LayanXCore){
 const firstHour=Number(process.env.LAYANX_QURAN_FIRST_HOUR??8);const firstMinute=Number(process.env.LAYANX_QURAN_FIRST_MINUTE??0);const secondHour=Number(process.env.LAYANX_QURAN_SECOND_HOUR??20);const secondMinute=Number(process.env.LAYANX_QURAN_SECOND_MINUTE??0);if(![firstHour,firstMinute,secondHour,secondMinute].every(Number.isInteger))throw new Error("quran_schedule_time_invalid");
 const goals=["quran.publish_next","quran.publish_next"] as const;const times=[[firstHour,firstMinute],[secondHour,secondMinute]] as const;const existing=core.scheduler.list();for(let i=0;i<times.length;i++){const goal=goals[i]!;const [hour,minute]=times[i]!;if(existing.some(s=>s.goal===goal&&s.enabled))continue;core.scheduler.register({goal,projectId:"quran-channel",trigger:{kind:"daily",hour,minute},enabled:true,maxSteps:12,agentId:"core"});}
 return core.scheduler.list().filter(s=>s.projectId==="quran-channel");
}
