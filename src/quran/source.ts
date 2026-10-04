export type QuranEnvironment="prelive"|"production";
export interface QuranSourceConfig{clientId:string;clientSecret:string;environment?:QuranEnvironment;translationId?:number;recitationId:number;}
export interface QuranSourceVerse{surah:number;ayah:number;verseKey:string;arabic:string;translation?:string;audioUrl:string;}
interface TokenState{token:string;expiresAt:number}
const AUTH_BASE={prelive:"https://prelive-oauth2.quran.foundation",production:"https://oauth2.quran.foundation"} as const;
const API_BASE={prelive:"https://apis-prelive.quran.foundation",production:"https://apis.quran.foundation"} as const;

export class QuranFoundationSource{
 private tokenState?:TokenState;
 private inflight?:Promise<string>;
 constructor(private readonly config:QuranSourceConfig,private readonly fetchImpl:typeof fetch=fetch){}
 private async token(force=false){
  if(!force&&this.tokenState&&Date.now()<this.tokenState.expiresAt-30000)return this.tokenState.token;
  if(this.inflight)return this.inflight;
  this.inflight=this.fetchToken().finally(()=>{this.inflight=undefined;});
  return this.inflight;
 }
 private async fetchToken(){
  const env=this.config.environment??"prelive";const basic=Buffer.from(this.config.clientId+":"+this.config.clientSecret).toString("base64");
  const response=await this.fetchImpl(AUTH_BASE[env]+"/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+basic,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",scope:"content"})});
  if(!response.ok)throw new Error("quran_auth_http_"+response.status);
  const data=await response.json() as {access_token?:string;expires_in?:number};
  if(!data.access_token)throw new Error("quran_auth_token_missing");
  this.tokenState={token:data.access_token,expiresAt:Date.now()+(data.expires_in??3600)*1000};return data.access_token;
 }
 private async get(path:string,query:Record<string,string>={},retry=true){
  const env=this.config.environment??"prelive";const token=await this.token();const url=new URL(API_BASE[env]+path);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
  const response=await this.fetchImpl(url,{headers:{"x-auth-token":token,"x-client-id":this.config.clientId}});
  if(response.status===401&&retry){this.tokenState=undefined;return this.get(path,query,false);}
  if(!response.ok)throw new Error("quran_api_http_"+response.status);
  return response.json() as Promise<any>;
 }
 async chapter(surah:number):Promise<QuranSourceVerse[]>{
  if(!Number.isInteger(surah)||surah<1||surah>114)throw new Error("quran_invalid_surah");
  const all:QuranSourceVerse[]=[];let page=1;
  while(true){
   const params:{[key:string]:string}={audio:String(this.config.recitationId),fields:"text_uthmani",per_page:"50",page:String(page)};
   if(this.config.translationId)params.translations=String(this.config.translationId);
   const data=await this.get("/content/api/v4/verses/by_chapter/"+surah,params);
   for(const verse of data.verses??[]){
    const audio=verse.audio?.url??verse.audio?.audioUrl;if(typeof audio!=="string"||!audio)throw new Error("quran_audio_missing:"+verse.verse_key);
    const tr=Array.isArray(verse.translations)?verse.translations[0]?.text:undefined;
    all.push({surah,ayah:Number(verse.verse_number),verseKey:String(verse.verse_key),arabic:String(verse.text_uthmani??""),translation:typeof tr==="string"?tr:undefined,audioUrl:audio});
   }
   const next=data.pagination?.next_page;if(!next)break;page=Number(next);
  }
  return all;
 }
}
