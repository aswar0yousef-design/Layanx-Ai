import {createHash} from "node:crypto";
import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolRequest} from "../core/types.js";
import type {BusinessManager} from "./manager.js";
import type {ContentItem,SocialPlatform} from "./types.js";
import {extractJson} from "../providers/adaptive-ollama.js";
import {localSecret} from "../security/local-secret-vault.js";

/**
 * "Write an Instagram post about the Sidr honey offer" -> a draft the owner reads word for word.
 * "Publish the post" -> that exact text goes out, after the owner's approval of that exact text, and is then read back from
 * the platform. Rules:
 *  - Nothing is ever published without the owner's approval; the approval carries the text, so it cannot be reused for other words.
 *  - A number in the draft that the owner did not give (a price, a discount) is not accepted: the model is asked again, then refused.
 *  - "Write this post: <text>" is the owner's own words, used as they are.
 */
const PLATFORM_WORDS:Array<[SocialPlatform,RegExp]>=[
  ["instagram",/(?:انستقرام|انستغرام|انستا|الانستا|instagram|insta)/iu],["facebook",/(?:فيسبوك|فيس بوك|فيس|facebook|fb\b)/iu],
  ["x",/(?:تويتر|تغريده|اكس|منصه x|twitter|tweet|\bx\b)/iu],["linkedin",/(?:لينكدان|لينكد ان|linkedin)/iu],["tiktok",/(?:تيك ?توك|tiktok)/iu],
  ["youtube",/(?:يوتيوب|youtube)/iu],["pinterest",/(?:بنترست|pinterest)/iu]];
const norm=(t:string)=>t.toLowerCase().replace(/[ً-ْ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه");
const digits=(t:string)=>t.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
export function platformsIn(goal:string):SocialPlatform[]{const g=norm(goal);return PLATFORM_WORDS.filter(([,re])=>re.test(g)).map(([p])=>p);}

export type SocialIntent={kind:"draft";platforms:SocialPlatform[];own?:string}|{kind:"publish"};
export function socialIntent(goal:string):SocialIntent|null{
  const g=norm(goal).trim();
  // "How do I write a good post?" is a question for a conversation, not a request for a draft.
  if(/^(?:كيف|ما|ماذا|هل|لماذا|ليش|وش|ايش|how|what|why|should|can i)\s/iu.test(g)||/[?؟]\s*$/.test(g)&&!/^(?:اكتب|جهز|انشر|write|draft|publish)/iu.test(g))return null;
  const post=/(?:منشور|بوست|تغريده|بوست|post|tweet|caption)/iu.test(g);
  if(!post)return null;
  if(/^(?:انشر|نزل|ارسل|publish|post it|post the)/iu.test(g)&&/(?:المنشور|البوست|التغريده|منشور|the post|it\b)/iu.test(g)&&!/(?:اكتب|جهز|صمم|write|draft)/iu.test(g))return{kind:"publish"};
  if(/(?:اكتب|جهز|حضر|صغ|سوي|اعمل|ابغي|ابي|اريد|write|draft|create|make)/iu.test(g)){
    // "اكتب منشور نصه: ..." / "write this post: ..." -> the owner's own words.
    const own=/(?:نصه|بالنص|هذا النص|التالي|this post|the following|text)\s*[:：]\s*(.+)$/isu.exec(goal)?.[1]?.trim();
    return{kind:"draft",platforms:platformsIn(goal),...(own?{own:own.replace(/^["«“]+|["»”]+$/g,"")}:{})};
  }
  return null;
}

const LIMITS:Partial<Record<SocialPlatform,number>>={x:280,instagram:2200,linkedin:3000,facebook:5000,tiktok:2200,pinterest:500};
/** Numbers in the draft that are not in the owner's request (a model inventing a price or a discount). */
export function inventedNumbers(draft:string,request:string):string[]{
  const said=new Set((digits(request).match(/\d+(?:\.\d+)?/g)??[]).map(Number));
  return [...new Set((digits(draft).match(/\d+(?:\.\d+)?/g)??[]).filter(n=>!said.has(Number(n))))];
}
/**
 * Words in the draft that do not belong to the request's language. Seen live 2026-11-13 with a 3B model: an Arabic post with
 * "tôi", "nuestros", Thai and Italian words in it. For an Arabic request, a Latin word is allowed only as a hashtag or when the
 * owner wrote it; any other script (Thai, Cyrillic, CJK, accented Latin...) is never allowed.
 */
export function foreignWords(draft:string,request:string):string[]{
  if(!/[\u0600-\u06FF]/.test(request))return[];
  const said=new Set((request.toLowerCase().match(/[a-z0-9]+/g)??[]));
  const out:string[]=[];
  for(const raw of draft.split(/\s+/)){
    const w=raw.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu,"");
    if(!w||raw.startsWith("#")||/^https?:/i.test(w))continue;
    if(/[^\u0600-\u06FF\u0660-\u0669a-zA-Z0-9\u200c\u200d\u064B-\u065F\u0640]/u.test(w.replace(/\p{Extended_Pictographic}|\uFE0F/gu,""))){out.push(w);continue;}
    if(/[a-zA-Z]/.test(w)&&!said.has(w.toLowerCase().replace(/[^a-z0-9]/g,"")))out.push(w);
  }
  return[...new Set(out)];
}
const DRAFT_SCHEMA={type:"object",properties:{title:{type:"string"},body:{type:"string"}},required:["title","body"]};
export function draftPrompt(goal:string,platforms:SocialPlatform[],retryNote=""):string{
  const limit=Math.min(...platforms.map(p=>LIMITS[p]??2200));
  return["Write one social media post for the owner's business. Return ONLY JSON: {\"title\":\"a short internal title\",\"body\":\"the post itself\"}",
    `Platforms: ${platforms.join(", ")}. At most ${limit} characters. Write in the language of the request, natural and warm, like a person, not an advert full of emojis (two at most). A few relevant hashtags at the end are fine.`,
    "Use ONLY facts the request gives. Never add a price, a discount, a date, a phone number or any other number that is not in the request, and never claim health benefits, ingredients or awards the request does not state.",
    "Every word in the language of the request (an Arabic request gets an Arabic post: no English or other-language words except the owner's own brand names).",
    retryNote,"The owner's request:\n"+goal.slice(0,1500)].filter(Boolean).join("\n\n");
}
export async function writeDraft(goal:string,platforms:SocialPlatform[],think:(prompt:string,schema:Record<string,unknown>)=>Promise<string>):Promise<{title:string;body:string}>{
  let note="";
  for(let attempt=0;attempt<2;attempt++){
    const raw=extractJson(await think(draftPrompt(goal,platforms,note),DRAFT_SCHEMA)) as {title?:unknown;body?:unknown}|null;
    const body=typeof raw?.body==="string"?raw.body.trim():"";
    if(!body){note="The previous answer had no body. Write the post in body.";continue;}
    const extra=inventedNumbers(body,goal);
    const limit=Math.min(...platforms.map(p=>LIMITS[p]??2200));
    if(extra.length){note=`The previous draft contained numbers the owner never gave (${extra.join(", ")}). Remove them.`;continue;}
    const foreign=foreignWords(body,goal);
    if(foreign.length){note=`The previous draft mixed in words from other languages (${foreign.slice(0,6).join(", ")}). Write every word in the request's language.`;continue;}
    if(body.length>limit){note=`The previous draft had ${body.length} characters; the limit is ${limit}.`;continue;}
    return{title:(typeof raw?.title==="string"&&raw.title.trim()?raw.title.trim():body.split("\n")[0]!).slice(0,120),body};
  }
  throw new Error("The draft kept adding facts that are not in your request, mixing languages or running too long, so it was not saved. Say the details you want in the post.");
}

// ---------------------------------------------------------------------------------------------------- the latest draft
/** The planner asks this for the draft "publish the post" means, so the approval card carries its exact text. */
let latestDraft:(()=>{id:string;title:string;body:string;platforms:SocialPlatform[]}|null)|null=null;
export function setLatestDraftSource(source:typeof latestDraft){latestDraft=source;}
export function currentDraft(){try{return latestDraft?.()??null;}catch{return null;}}
export const textHash=(c:{body:string;platforms:SocialPlatform[]})=>createHash("sha256").update(JSON.stringify([c.body,[...c.platforms].sort()])).digest("hex").slice(0,16);

/** After publishing, the post is read back from the platform (Facebook, Instagram, X); the others report what they returned. */
export async function readBack(platform:SocialPlatform,externalId:string,fetcher:typeof fetch=fetch):Promise<{checked:boolean;text?:string;url?:string}>{
  const token=localSecret(`${platform}.social.token`,process.env[`LAYANX_${platform.toUpperCase()}_SOCIAL_TOKEN`])??"";
  if(!token)return{checked:false};
  const graph=(p:SocialPlatform)=>(process.env[`LAYANX_${p.toUpperCase()}_SOCIAL_BASE_URL`]??"https://graph.facebook.com").replace(/\/$/,"")+(process.env.LAYANX_META_GRAPH_VERSION?"/"+process.env.LAYANX_META_GRAPH_VERSION:"");
  const get=async(url:string)=>{const r=await fetcher(url,{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(15_000)});if(!r.ok)throw new Error("read back answered "+r.status);return r.json() as Promise<any>;};
  if(platform==="facebook"){const d=await get(`${graph("facebook")}/${encodeURIComponent(externalId)}?fields=message,permalink_url`);return{checked:true,text:String(d.message??""),...(d.permalink_url?{url:String(d.permalink_url)}:{})};}
  if(platform==="instagram"){const d=await get(`${graph("instagram")}/${encodeURIComponent(externalId)}?fields=caption,permalink`);return{checked:true,text:String(d.caption??""),...(d.permalink?{url:String(d.permalink)}:{})};}
  if(platform==="x"){const d=await get(`https://api.x.com/2/tweets/${encodeURIComponent(externalId)}`);return{checked:true,text:String(d?.data?.text??"")};}
  return{checked:false};
}

export function registerSocialPostingTools(core:LayanXCore,business:BusinessManager,deps:{fetcher?:typeof fetch}={}):void{
  setLatestDraftSource(()=>{
    const d=[...business.snapshot().content].filter(c=>c.status==="draft"&&(c as ContentItem&{origin?:string}).origin==="social.draft").sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    return d?{id:d.id,title:d.title,body:d.body,platforms:d.platforms}:null;
  });
  const think=async(prompt:string,schema:Record<string,unknown>)=>(await core.modelExecution.execute({capability:"reasoning",input:prompt,maxOutputTokens:900,responseSchema:schema,routing:{preferLocal:true}} as never)).output;
  core.tools.register({name:"social.draft",description:"write a social media post draft from the owner's words (payload.goal, payload.platforms) and show it word for word; nothing is published",
    permission:"L3_MODIFY",dangerous:false,actions:["social draft"],tags:["social","post","منشور","draft"]});
  core.toolAdapters.register("social.draft",{async execute(request:ToolRequest){
    const p=(request.payload??{}) as Record<string,unknown>;
    const goal=String(p.goal??"");
    const named=Array.isArray(p.platforms)?(p.platforms as SocialPlatform[]):platformsIn(goal);
    const connected=business.snapshot().socialAccounts.filter(a=>a.enabled).map(a=>a.platform);
    const platforms:SocialPlatform[]=named.length?named:connected.length?[...new Set(connected)]:["facebook","instagram"];
    const own=typeof p.own==="string"&&p.own.trim()?p.own.trim():"";
    const draft=own?{title:own.split("\n")[0]!.slice(0,120),body:own}:await writeDraft(goal,platforms,think);
    const item=business.createContent({title:draft.title,body:draft.body,platforms,mediaIds:[],status:"draft",origin:"social.draft"} as never);
    const missing=platforms.filter(pl=>!connected.includes(pl));
    return{contentId:item.id,body:item.body,platforms,ownWords:Boolean(own)&&item.body===own,...(own&&item.body!==own?{tidied:true}:{}),notConnected:missing,needsImage:platforms.filter(pl=>pl==="instagram"||pl==="pinterest"||pl==="tiktok"||pl==="youtube")};
  }});
  core.tools.register({name:"social.publish",description:"publish the owner's latest post draft (payload.contentId and payload.text, the exact words the owner approves) to its platforms, then read it back from each platform",
    permission:"L4_EXECUTE",dangerous:true,actions:["social publish"],tags:["social","publish","post","انشر","منشور"]});
  core.toolAdapters.register("social.publish",{async execute(request:ToolRequest){
    const p=(request.payload??{}) as Record<string,unknown>;
    const item=business.snapshot().content.find(c=>c.id===String(p.contentId??""));
    if(!item)throw new Error("There is no post draft to publish. Ask for a post first, read it, then say: publish the post.");
    // The approval was given for these exact words: if the draft changed since, nothing goes out.
    if(typeof p.text!=="string"||p.text!==item.body)throw new Error("The draft changed after you saw it, so it was not published. Read the current text and approve it again.");
    if(item.status==="draft")business.updateContent(item.id,{status:"approved"});
    const result=await business.publishContent(item.id) as {results:Array<{platform:SocialPlatform;externalId:string;url?:string}>;failures:Array<{platform:SocialPlatform;error:string}>;status:string};
    const published:Array<{platform:SocialPlatform;url?:string;verified:boolean|null;note?:string}>=[];
    for(const r of result.results){
      try{const back=await readBack(r.platform,r.externalId,deps.fetcher);
        published.push({platform:r.platform,...(back.url??r.url?{url:back.url??r.url}:{}),verified:back.checked?back.text?.trim()===item.body.trim():null,...(back.checked&&back.text?.trim()!==item.body.trim()?{note:"the platform shows different text: "+String(back.text).slice(0,200)}:{})});
      }catch(error){published.push({platform:r.platform,...(r.url?{url:r.url}:{}),verified:null,note:"could not read it back: "+(error instanceof Error?error.message:String(error))});}
    }
    if(!published.length)throw new Error("Nothing was published: "+result.failures.map(f=>f.platform+": "+f.error).join("; "));
    if(published.some(x=>x.verified===false))throw new Error("Published, but the platform shows different text: "+JSON.stringify(published));
    return{contentId:item.id,published,failures:result.failures};
  }});
}
