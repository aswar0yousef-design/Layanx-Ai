import {createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import type {MediaAsset,MediaKind} from "./types.js";

export interface MediaInspection{url:string;kind:MediaKind;mimeType?:string;contentLength?:number;reachable:boolean;inspectedAt:string;}
const now=()=>new Date().toISOString();
function inferKind(mime?:string,url=""):MediaKind{
 const value=(mime??"").toLowerCase();
 if(value.startsWith("image/"))return "image";
 if(value.startsWith("video/"))return "video";
 if(value.startsWith("audio/"))return "audio";
 if(value.includes("pdf")||value.includes("document")||value.includes("text/"))return "document";
 const ext=(url.split("?")[0]??"").toLowerCase().split(".").pop();
 if(["jpg","jpeg","png","webp","gif","avif"].includes(ext??""))return "image";
 if(["mp4","mov","webm","m4v"].includes(ext??""))return "video";
 if(["mp3","wav","m4a","ogg"].includes(ext??""))return "audio";
 return "document";
}
async function head(url:string){
 const r=await fetch(url,{method:"HEAD",redirect:"follow"});
 return {ok:r.ok,status:r.status,mime:r.headers.get("content-type")??undefined,length:Number(r.headers.get("content-length")??"")||undefined};
}
export class MediaManager{
 private readonly path=process.env.LAYANX_MEDIA_STORAGE_PATH??".layanx/media.json";
 private items:MediaInspection[]=[];
 constructor(){this.load();}
 private load(){try{if(existsSync(this.path))this.items=JSON.parse(readFileSync(this.path,"utf8")) as MediaInspection[];}catch{this.items=[];}}
 private persist(){mkdirSync(dirname(this.path),{recursive:true});const tmp=this.path+".tmp";writeFileSync(tmp,JSON.stringify(this.items,null,2),"utf8");renameSync(tmp,this.path);}
 async inspect(url:string):Promise<MediaInspection>{
  if(!/^https?:\/\//i.test(url))throw new Error("media_url_must_be_http");
  const existing=this.items.find(x=>x.url===url);
  try{
   const r=await head(url);
   if(!r.ok)throw new Error(`media_http_${r.status}`);
   const result:MediaInspection={url,kind:inferKind(r.mime,url),mimeType:r.mime,contentLength:r.length,reachable:true,inspectedAt:now()};
   const previous=this.items.findIndex(x=>x.url===url);if(previous>=0)this.items[previous]=result;else this.items.push(result);this.persist();return result;
  }catch(error){
   if(existing)return {...existing,reachable:false,inspectedAt:now()};
   throw error;
  }
 }
 async register(url:string,metadata:Record<string,unknown>={}):Promise<MediaAsset>{
  const inspection=await this.inspect(url);
  const hash=createHash("sha256").update(url).digest("hex");
  return {id:`media_${hash.slice(0,24)}`,kind:inspection.kind,url,metadata:{...metadata,mimeType:inspection.mimeType,contentLength:inspection.contentLength,reachable:inspection.reachable,inspectedAt:inspection.inspectedAt},createdAt:now()};
 }
 snapshot(){return [...this.items];}
}