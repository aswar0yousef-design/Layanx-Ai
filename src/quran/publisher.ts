import {createHash} from "node:crypto";
export interface QuranVerse{surah:number;ayah:number;arabic:string;recitationDurationSec:number;translation?:string;audioPath?:string;}
export interface QuranSegment{surah:number;fromAyah:number;toAyah:number;durationSec:number;verses:QuranVerse[];}
export interface QuranPublisherPolicy{minDurationSec:number;maxDurationSec:number;targetDurationSec:number;neverSplitVerse:boolean;avoidPublishedSegments:boolean;}
export interface QuranPublishedSegment{surah:number;fromAyah:number;toAyah:number;durationSec:number;publicationIds:string[];publishedAt:string;}
export interface QuranPublicationPlan{segment:QuranSegment;idempotencyKey:string;title:string;description:string;hashtags:string[];}
const DEFAULT_POLICY:QuranPublisherPolicy={minDurationSec:30,maxDurationSec:60,targetDurationSec:45,neverSplitVerse:true,avoidPublishedSegments:true};
const normalize=(n:number)=>Number(n.toFixed(3));
const keyOf=(surah:number,from:number,to:number)=>createHash("sha256").update("quran:"+surah+":"+from+":"+to).digest("hex").slice(0,24);
export class QuranPublisher{
 readonly policy:QuranPublisherPolicy;
 constructor(policy:Partial<QuranPublisherPolicy>={}){this.policy={...DEFAULT_POLICY,...policy};if(this.policy.minDurationSec<=0||this.policy.maxDurationSec<this.policy.minDurationSec)throw new Error("quran_invalid_duration_policy");}
 planSegment(verses:QuranVerse[],startIndex=0,published:QuranPublishedSegment[]=[]):QuranSegment{
  if(!verses.length)throw new Error("quran_verses_required");if(startIndex<0||startIndex>=verses.length)throw new Error("quran_start_index_out_of_range");
  const first=verses[startIndex];if(first.recitationDurationSec<=0)throw new Error("quran_invalid_recitation_duration");
  const publishedKeys=new Set(published.map(x=>x.surah+":"+x.fromAyah+":"+x.toAyah));let total=0;let end=startIndex;
  for(let i=startIndex;i<verses.length;i++){const verse=verses[i];if(verse.surah!==first.surah)break;if(verse.recitationDurationSec<=0)throw new Error("quran_invalid_recitation_duration");const next=normalize(total+verse.recitationDurationSec);if(i>startIndex&&next>this.policy.maxDurationSec)break;total=next;end=i;if(total>=this.policy.targetDurationSec)break;}
  if(total<this.policy.minDurationSec){for(let i=end+1;i<verses.length;i++){const verse=verses[i];if(verse.surah!==first.surah)break;const next=normalize(total+verse.recitationDurationSec);if(next>this.policy.maxDurationSec)break;total=next;end=i;if(total>=this.policy.minDurationSec)break;}}
  const segmentVerses=verses.slice(startIndex,end+1);if(!segmentVerses.length)throw new Error("quran_segment_empty");
  const candidateKey=first.surah+":"+first.ayah+":"+segmentVerses[segmentVerses.length-1].ayah;const overlaps=published.some(p=>p.surah===first.surah&&first.ayah<=p.toAyah&&segmentVerses[segmentVerses.length-1].ayah>=p.fromAyah);if(this.policy.avoidPublishedSegments&&(publishedKeys.has(candidateKey)||overlaps))throw new Error("quran_segment_already_published");
  return {surah:first.surah,fromAyah:first.ayah,toAyah:segmentVerses[segmentVerses.length-1].ayah,durationSec:normalize(total),verses:segmentVerses};
 }
 buildPlan(segment:QuranSegment,translationLanguage="en"):QuranPublicationPlan{
  const key=keyOf(segment.surah,segment.fromAyah,segment.toAyah);const translation=segment.verses.map(v=>v.translation).filter(Boolean).join(" ");
  const description="Surah "+segment.surah+", verses "+segment.fromAyah+"-"+segment.toAyah+"\\n\\nTranslation ("+translationLanguage+"):\\n"+translation;
  return {segment,idempotencyKey:key,title:"Quran — Surah "+segment.surah+" • "+segment.fromAyah+"-"+segment.toAyah,description,hashtags:["#Quran","#القرآن","#QuranKareem","#Islam"]};
 }
}