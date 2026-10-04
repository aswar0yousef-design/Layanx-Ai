import {localSecret} from "../security/local-secret-vault.js";
import {readFile} from "node:fs/promises";
import type {SocialAccount,SocialPlatform} from "./types.js";

export interface PublishItem{title:string;body:string;mediaUrls:string[]}
export interface NativeSocialResult{externalId:string;url?:string}
export type NativeSocialStatus = "processing"|"published"|"failed"|"unknown";
export interface NativeSocialStatusResult { externalId:string; status:NativeSocialStatus; detail?:string; }
export interface PlatformSocialConnector{platform:SocialPlatform;publish(account:SocialAccount,item:PublishItem):Promise<NativeSocialResult>;status?(account:SocialAccount,externalId:string):Promise<NativeSocialStatusResult>}

async function jsonRequest(url:string,init:RequestInit={}):Promise<any>{
 const r=await fetch(url,init);const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}};
 if(!r.ok)throw new Error(`social_native_http_${r.status}`);
 return data;
}
function token(platform:SocialPlatform,account?:SocialAccount){
 if((platform==="facebook"||platform==="instagram")&&account?.externalId){
  const pageToken=localSecret(`meta.page.${account.externalId}.token`,undefined);
  if(pageToken)return pageToken;
 }
 const p=platform.toUpperCase();
 return localSecret(`${platform}.social.token`,process.env[`LAYANX_${p}_SOCIAL_TOKEN`])??"";
}
function requireId(account:SocialAccount){if(!account.externalId)throw new Error("social_account_external_id_required");return account.externalId;}
function base(platform:SocialPlatform, fallback:string){return (process.env[`LAYANX_${platform.toUpperCase()}_SOCIAL_BASE_URL`]??fallback).replace(/\/$/,"");}

export class NativeSocialConnector implements PlatformSocialConnector{
 constructor(public readonly platform:SocialPlatform){}
 async publish(account:SocialAccount,item:PublishItem):Promise<NativeSocialResult>{
  const access=token(this.platform,account);if(!access)throw new Error(`LAYANX_${this.platform.toUpperCase()}_SOCIAL_TOKEN is required`);
  switch(this.platform){
   case "instagram": return this.instagram(requireId(account),access,item);
   case "facebook": return this.facebook(requireId(account),access,item);
   case "tiktok": return this.tiktok(access,item);
   case "youtube": return this.youtube(access,item);
   case "linkedin": return this.linkedin(requireId(account),access,item);
   case "x": return this.x(access,item);
   case "pinterest": return this.pinterest(requireId(account),access,item);
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
  const media=item.mediaUrls.find(x=>/^https?:\/\//i.test(x)||x.startsWith("file://")||x.startsWith("/")||/^[A-Za-z]:\\/.test(x));if(!media)throw new Error("tiktok_requires_video_media");
  const api=base("tiktok","https://open.tiktokapis.com");
  const info=await jsonRequest(api+"/v2/post/publish/creator_info/query/",{method:"POST",headers:{Authorization:"Bearer "+access,"content-type":"application/json"}});
  const options=info?.data?.privacy_level_options??[];const privacy=process.env.LAYANX_TIKTOK_PRIVACY_LEVEL??"SELF_ONLY";if(!options.includes(privacy))throw new Error("tiktok_privacy_level_not_allowed");
  if(media.startsWith("file://")||media.startsWith("/")||/^[A-Za-z]:\\/.test(media))return this.tiktokFileUpload(access,item,media,api,privacy);
  const body={post_info:{title:item.title,description:item.body,privacy_level:privacy},source_info:{source:"PULL_FROM_URL",video_url:media},post_mode:"DIRECT_POST",media_type:"VIDEO"};
  const d=await jsonRequest(api+"/v2/post/publish/content/init/",{method:"POST",headers:{Authorization:"Bearer "+access,"content-type":"application/json"},body:JSON.stringify(body)});
  const id=String(d?.data?.publish_id??"");if(!id)throw new Error("tiktok_publish_id_missing");return {externalId:id};
}
private async tiktokFileUpload(access:string,item:PublishItem,media:string,api:string,privacy:string){
  const filePath=media.startsWith("file://")?new URL(media):media;const data=await readFile(filePath as any);const size=data.byteLength;const chunkSize=Math.min(10*1024*1024,size);
  const init=await jsonRequest(api+"/v2/post/publish/video/init/",{method:"POST",headers:{Authorization:"Bearer "+access,"content-type":"application/json"},body:JSON.stringify({post_info:{title:item.title,description:item.body,privacy_level:privacy},source_info:{source:"FILE_UPLOAD",video_size:size,chunk_size:chunkSize,total_chunk_count:Math.ceil(size/chunkSize)}})});
  const uploadUrl=String(init?.data?.upload_url??"");const publishId=String(init?.data?.publish_id??"");if(!uploadUrl||!publishId)throw new Error("tiktok_upload_init_missing");
  for(let start=0;start<size;start+=chunkSize){const end=Math.min(start+chunkSize,size)-1;const chunk=data.subarray(start,end+1);const r=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":"video/mp4","Content-Length":String(chunk.byteLength),"Content-Range":"bytes "+start+"-"+end+"/"+size},body:chunk});if(!r.ok)throw new Error("tiktok_upload_http_"+r.status);}
  return {externalId:publishId};
}
async status(account:SocialAccount,externalId:string):Promise<NativeSocialStatusResult>{
  const access=token(this.platform,account);if(!access)throw new Error("LAYANX_"+this.platform.toUpperCase()+"_SOCIAL_TOKEN is required");
  if(this.platform==="tiktok"){const api=base("tiktok","https://open.tiktokapis.com");const d=await jsonRequest(api+"/v2/post/publish/status/fetch/",{method:"POST",headers:{Authorization:"Bearer "+access,"content-type":"application/json"},body:JSON.stringify({publish_id:externalId})});const s=String(d?.data?.status??"");return {externalId,status:s==="PUBLISH_COMPLETE"?"published":s==="FAILED"?"failed":"processing",detail:d?.data?.fail_reason};}
  if(this.platform==="youtube"){const d=await jsonRequest("https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id="+encodeURIComponent(externalId),{headers:{Authorization:"Bearer "+access}});const item=d?.items?.[0];if(!item)return {externalId,status:"failed",detail:"youtube_video_not_found"};const upload=item.status?.uploadStatus;const processing=item.processingDetails?.processingStatus;if(upload==="processed"&&processing==="succeeded")return {externalId,status:"published"};if(upload==="rejected"||processing==="failed")return {externalId,status:"failed",detail:item.status?.failureReason??item.processingDetails?.processingFailureReason};return {externalId,status:"processing"};}
  return {externalId,status:"unknown"};
}

 private async youtube(access:string,item:PublishItem){
  const video=item.mediaUrls.find(x=>/\.(mp4|mov|webm|m4v)(\?|$)/i.test(x)||x.startsWith("file://")||x.startsWith("/")||/^[A-Za-z]:\\/.test(x));if(!video)throw new Error("youtube_requires_video_media");
  const blob=video.startsWith("file://")||video.startsWith("/")||/^[A-Za-z]:\\/.test(video)?new Blob([await readFile(video.startsWith("file://")?new URL(video):video as any)],{type:"video/mp4"}):await (async()=>{const source=await fetch(video);if(!source.ok)throw new Error("youtube_media_fetch_"+source.status);return source.blob();})();

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
 private async pinterest(boardId:string,access:string,item:PublishItem){
  const image=item.mediaUrls.find(x=>/\.(jpe?g|png|webp)(\?|$)/i.test(x)||/^https?:\/\//i.test(x));
  if(!image)throw new Error("pinterest_requires_public_image_url");
  const api=(process.env.LAYANX_PINTEREST_SOCIAL_BASE_URL??"https://api.pinterest.com/v5").replace(/\/$/,"");
  const body={board_id:boardId,title:item.title.slice(0,100),description:item.body,media_source:{source_type:"image_url",url:image,is_standard:true}};
  const d=await jsonRequest(`${api}/pins`,{method:"POST",headers:{Authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const id=String(d?.id??"");if(!id)throw new Error("pinterest_pin_id_missing");
  return {externalId:id,url:`https://www.pinterest.com/pin/${id}/`};
 }
 private async x(access:string,item:PublishItem){
  const d=await jsonRequest("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify({text:item.body})});
  const id=String(d?.data?.id??"");if(!id)throw new Error("x_post_id_missing");return {externalId:id,url:`https://x.com/i/web/status/${id}`};
 }
}
