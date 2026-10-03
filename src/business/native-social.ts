import {localSecret} from "../security/local-secret-vault.js";
import type {SocialAccount,SocialPlatform} from "./types.js";

export interface PublishItem{title:string;body:string;mediaUrls:string[]}
export interface NativeSocialResult{externalId:string;url?:string}
export interface NativeSocialConnector{platform:SocialPlatform;publish(account:SocialAccount,item:PublishItem):Promise<NativeSocialResult>}

async function jsonRequest(url:string,init:RequestInit={}):Promise<any>{
 const r=await fetch(url,init);const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}};
 if(!r.ok)throw new Error(`social_native_http_${r.status}`);
 return data;
}
function token(platform:SocialPlatform){
 const p=platform.toUpperCase();
 return localSecret(`${platform}.social.token`,process.env[`LAYANX_${p}_SOCIAL_TOKEN`])??"";
}
function requireId(account:SocialAccount){if(!account.externalId)throw new Error("social_account_external_id_required");return account.externalId;}
function base(platform:SocialPlatform, fallback:string){return (process.env[`LAYANX_${platform.toUpperCase()}_SOCIAL_BASE_URL`]??fallback).replace(/\/$/,"");}

export class NativeSocialConnector implements NativeSocialConnector{
 constructor(public readonly platform:SocialPlatform){}
 async publish(account:SocialAccount,item:PublishItem):Promise<NativeSocialResult>{
  const access=token(this.platform);if(!access)throw new Error(`LAYANX_${this.platform.toUpperCase()}_SOCIAL_TOKEN is required`);
  switch(this.platform){
   case "instagram": return this.instagram(requireId(account),access,item);
   case "facebook": return this.facebook(requireId(account),access,item);
   case "tiktok": return this.tiktok(requireId(account),access,item);
   case "youtube": return this.youtube(access,item);
   case "linkedin": return this.linkedin(requireId(account),access,item);
   case "x": return this.x(access,item);
   default: throw new Error(`native_social_not_implemented:${this.platform}`);
  }
 }
 private async instagram(id:string,access:string,item:PublishItem){
  const image=item.mediaUrls.find(x=>/^https?:\/\//i.test(x));if(!image)throw new Error("instagram_requires_public_media_url");
  const graph=base("instagram","https://graph.facebook.com");
  const version=process.env.LAYANX_META_GRAPH_VERSION??"";
  const prefix=version?`/${version}`:"";
  const q=new URLSearchParams({image_url:image,caption:item.body,access_token:access});
  const created=await jsonRequest(`${graph}${prefix}/${encodeURIComponent(id)}/media?${q}`,{method:"POST"});
  if(!created.id)throw new Error("instagram_media_container_missing");
  const published=await jsonRequest(`${graph}${prefix}/${encodeURIComponent(id)}/media_publish`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({creation_id:created.id,access_token:access})});
  const externalId=String(published.id??"");if(!externalId)throw new Error("instagram_publish_id_missing");
  return {externalId,url:`https://www.instagram.com/p/${externalId}/`};
 }
 private async facebook(pageId:string,access:string,item:PublishItem){
  const graph=base("facebook","https://graph.facebook.com");const version=process.env.LAYANX_META_GRAPH_VERSION??"";const prefix=version?`/${version}`:"";
  const q=new URLSearchParams({message:item.body,access_token:access});const media=item.mediaUrls.find(x=>/^https?:\/\//i.test(x));if(media)q.set("link",media);
  const d=await jsonRequest(`${graph}${prefix}/${encodeURIComponent(pageId)}/feed?${q}`,{method:"POST"});
  const externalId=String(d.id??"");if(!externalId)throw new Error("facebook_post_id_missing");return {externalId,url:`https://www.facebook.com/${externalId}`};
 }
 private async tiktok(access:string,item:PublishItem){
  const media=item.mediaUrls.find(x=>/^https?:\/\//i.test(x));if(!media)throw new Error("tiktok_requires_public_media_url");
  const api=base("tiktok","https://open.tiktokapis.com");
  const info=await jsonRequest(`${api}/v2/post/publish/creator_info/query/`,{method:"POST",headers:{Authorization:`Bearer ${access}`,"content-type":"application/json"}});
  const privacy=info?.data?.privacy_level_options?.[0];if(!privacy)throw new Error("tiktok_creator_info_missing_privacy");
  const isImage=/\.(jpe?g|png|webp)(\?|$)/i.test(media);const body=isImage?
   {post_info:{title:item.title,description:item.body,privacy_level:privacy},source_info:{source:"PULL_FROM_URL",photo_images:[media],photo_cover_index:0},post_mode:"DIRECT_POST",media_type:"PHOTO"}:
   {post_info:{title:item.title,description:item.body,privacy_level:privacy},source_info:{source:"PULL_FROM_URL",video_url:media},post_mode:"DIRECT_POST",media_type:"VIDEO"};
  const d=await jsonRequest(`${api}/v2/post/publish/content/init/`,{method:"POST",headers:{Authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const id=String(d?.data?.publish_id??"");if(!id)throw new Error("tiktok_publish_id_missing");return {externalId:id};
 }
 private async youtube(access:string,item:PublishItem){
  const video=item.mediaUrls.find(x=>/\.(mp4|mov|webm|m4v)(\?|$)/i.test(x));if(!video)throw new Error("youtube_requires_video_url");
  const source=await fetch(video);if(!source.ok)throw new Error(`youtube_media_fetch_${source.status}`);const blob=await source.blob();
  const metadata={snippet:{title:item.title.slice(0,100),description:item.body},status:{privacyStatus:process.env.LAYANX_YOUTUBE_PRIVACY_STATUS??"private"}};
  const form=new FormData();form.append("metadata",new Blob([JSON.stringify(metadata)],{type:"application/json"}));form.append("media",blob,"upload");
  const d=await jsonRequest("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",{method:"POST",headers:{Authorization:`Bearer ${access}`},body:form});
  const id=String(d?.id??"");if(!id)throw new Error("youtube_video_id_missing");return {externalId:id,url:`https://www.youtube.com/watch?v=${id}`};
 }
 private async linkedin(author:string,access:string,item:PublishItem){
  const url=process.env.LAYANX_LINKEDIN_SOCIAL_POST_URL??"https://api.linkedin.com/rest/posts";
  const d=await jsonRequest(url,{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json","X-Restli-Protocol-Version":"2.0.0","Linkedin-Version":process.env.LAYANX_LINKEDIN_VERSION??"202601"},body:JSON.stringify({author:author.startsWith("urn:")?author:`urn:li:person:${author}`,commentary:item.body,visibility:"PUBLIC",distribution:{feedDistribution:"MAIN_FEED"},lifecycleState:"PUBLISHED",isReshareDisabledByAuthor:false})});
  const id=String(d?.id??d?.["x-restli-id"]??"");if(!id)throw new Error("linkedin_post_id_missing");return {externalId:id,url:`https://www.linkedin.com/feed/update/${encodeURIComponent(id)}`};
 }
 private async x(access:string,item:PublishItem){
  const d=await jsonRequest("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify({text:item.body})});
  const id=String(d?.data?.id??"");if(!id)throw new Error("x_post_id_missing");return {externalId:id,url:`https://x.com/i/web/status/${id}`};
 }
}
