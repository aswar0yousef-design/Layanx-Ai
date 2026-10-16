import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {PLATFORM_RULES,TEXT_KINDS,cleanText,humanizeText,humanizerMode,loadVoice,normalizeVoice,scanText,type GenerateText,type HumanizeOptions,type HumanizePlatform,type TextFormat,type TextKind} from "./humanizer.js";

export const HUMANIZE_TOOL="content.humanize";
const MAX_TEXT=20_000;

/** Options from a tool payload or an API body; anything unknown falls back to a safe default. */
export function humanizeOptions(p:Record<string,unknown>):HumanizeOptions{
  const platform=typeof p.platform==="string"&&Object.hasOwn(PLATFORM_RULES,p.platform)?p.platform as HumanizePlatform:"generic";
  const kind=typeof p.kind==="string"&&TEXT_KINDS.includes(p.kind as TextKind)?p.kind as TextKind:"post";
  const format=p.format==="html"||p.format==="markdown"?p.format as TextFormat:"text";
  const keep=Array.isArray(p.keep)?p.keep.filter((x):x is string=>typeof x==="string").map(x=>x.slice(0,80)).slice(0,30):[];
  const voice=p.voice&&typeof p.voice==="object"?normalizeVoice(p.voice):loadVoice();
  return{platform,kind,format,keep,voice,...(p.lang==="ar"||p.lang==="en"?{lang:p.lang}:{}),...(typeof p.maxAttempts==="number"?{maxAttempts:p.maxAttempts}:{})};
}

/**
 * content.humanize — one entry point for every text LayanX writes for people.
 * mode "check" scores it, "clean" also removes hidden traces, "rewrite" (default)
 * lets the local model fix what the checks found, without losing any fact.
 */
export async function runHumanize(payload:Record<string,unknown>,generate?:GenerateText,env:NodeJS.ProcessEnv=process.env){
  const text=typeof payload.text==="string"?payload.text:"";
  if(!text.trim())throw new Error("humanize_text_required");
  if(text.length>MAX_TEXT)throw new Error("humanize_text_too_long");
  const options=humanizeOptions(payload);
  const asked=payload.mode==="check"||payload.mode==="clean"?payload.mode:"rewrite";
  const allowed=humanizerMode(env);
  const mode=asked==="rewrite"&&allowed!=="rewrite"?"clean":asked;
  if(mode==="check")return{mode,report:scanText(text,options)};
  if(mode==="clean"){
    const c=cleanText(text,options);
    return{mode,text:c.text,changes:c.changes,report:scanText(c.text,options),...(asked!==mode?{note:"rewrite_disabled"}:{})};
  }
  const r=await humanizeText(text,options,generate);
  return{mode,text:r.text,rewritten:r.rewritten,changes:r.cleaned,before:r.before,after:r.after,attempts:r.attempts,lost:r.lost,...(r.note?{note:r.note}:{})};
}

/** The writer every content path shares: the owner's local model first (cloud only within the cloud budget). */
export function modelWriter(core:LayanXCore):GenerateText{
  return async(input,maxOutputTokens)=>(await core.modelExecution.execute({capability:"chat",input,maxOutputTokens,routing:{preferLocal:true}})).output;
}

/** Registered for every role: the business agent uses it for posts, the coder for website and app copy. */
export function registerHumanizerTool(core:LayanXCore,generate?:GenerateText){
  core.tools.register({name:HUMANIZE_TOOL,description:"check and improve text written for people (social posts, website and app copy, store listings, scripts, e-mails) so it reads human; keeps every fact; use before publishing or shipping any copy",permission:"L2_ANALYZE",dangerous:false,actions:[HUMANIZE_TOOL],tags:["content","writing","social","web"]});
  const adapter:ToolAdapter={async execute(request){return runHumanize((request.payload??{}) as Record<string,unknown>,generate);}};
  core.toolAdapters.register(HUMANIZE_TOOL,adapter);
}
