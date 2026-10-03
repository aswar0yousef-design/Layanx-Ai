import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import type {CreatorDoctorReport,CreatorEngineOptions,CreatorPlanInput,CreatorProject,CreatorScene} from "./types.js";
const now=()=>new Date().toISOString();
const clamp=(n:number,min:number,max:number)=>Math.min(Math.max(n,min),max);
function safeName(value:string){return value.normalize("NFKC").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"project";}
function splitScript(text:string){return text.split(/(?<=[.!?؟。])\s+/).map(x=>x.trim()).filter(Boolean);}
async function commandExists(command:string){return new Promise<boolean>(resolveResult=>{const p=spawn(command,["-version"],{stdio:"ignore"});p.on("error",()=>resolveResult(false));p.on("close",code=>resolveResult(code===0));});}
export class CreatorEngine{
 readonly root:string;
 constructor(private readonly options:CreatorEngineOptions={}){this.root=resolve(options.root??process.env.LAYANX_CREATOR_OUTPUT_DIR??".layanx/creator");mkdirSync(this.root,{recursive:true});}
 async plan(input:CreatorPlanInput):Promise<CreatorProject>{
  const topic=input.topic.trim();if(!topic)throw new Error("creator_topic_required");
  const duration=clamp(Math.round(input.durationSec??45),15,600);const platform=input.platform??"both";const language=input.language??"ar";const style=input.style??"documentary_short";
  const fallback={title:input.title??topic,hook:"هل تعرف الحقيقة وراء "+topic+"؟",script:"مقدمة: "+topic+".\nسنشرح الفكرة باختصار ونذكر أهم الحقائق الموثوقة.\nالخاتمة: تابعنا للمزيد."};let generated=fallback;
  if(this.options.generateText){const raw=await this.options.generateText("Create a factual short-video package about: "+topic+". Language: "+language+". Style: "+style+". Duration: "+duration+"s. Return JSON with keys title,hook,script. Do not invent facts.");try{const parsed=JSON.parse(raw) as Partial<typeof fallback>;generated={title:String(parsed.title||fallback.title),hook:String(parsed.hook||fallback.hook),script:String(parsed.script||fallback.script)};}catch{}}
  const sentences=splitScript(generated.script);const count=Math.max(1,Math.min(sentences.length,12));const per=duration/count;
  const scenes:CreatorScene[]=sentences.slice(0,12).map((narration,index)=>({id:"scene_"+(index+1),index:index+1,narration,visualPrompt:"cinematic documentary visual for: "+narration,durationSec:Number(per.toFixed(2))}));
  const project:CreatorProject={id:"creator_"+randomUUID(),title:generated.title,topic,platform,aspectRatio:platform==="youtube"?"16:9":"9:16",language,hook:generated.hook,script:generated.script,scenes,createdAt:now()};this.save(project);return project;
 }
 save(project:CreatorProject){const dir=join(this.root,safeName(project.id));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,"project.json"),JSON.stringify(project,null,2),"utf8");writeFileSync(join(dir,"script.txt"),project.script,"utf8");return dir;}
 load(id:string){const path=join(this.root,safeName(id),"project.json");if(!existsSync(path))throw new Error("creator_project_not_found");return JSON.parse(readFileSync(path,"utf8")) as CreatorProject;}
 async render(id:string,outputPath?:string){
  const project=this.load(id);if(project.scenes.some(s=>!s.assetPath))throw new Error("creator_scene_assets_required");
  const ffmpeg=process.env.LAYANX_FFMPEG_PATH??"ffmpeg";if(!(await commandExists(ffmpeg)))throw new Error("ffmpeg_not_available");
  const out=resolve(outputPath??join(this.root,safeName(project.id),safeName(project.title)+".mp4"));const rootPrefix=this.root.endsWith("/")?this.root:this.root+"/";if(!out.startsWith(rootPrefix))throw new Error("creator_output_outside_workspace");
  const args:string[]=[];project.scenes.forEach(scene=>{const asset=resolve(scene.assetPath!);if(!asset.startsWith(rootPrefix))throw new Error("creator_asset_outside_workspace");args.push("-loop","1","-t",String(scene.durationSec),"-i",asset);});
  const filters=project.scenes.map((_,i)=>"["+i+":v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v"+i+"]").join(";");const concat=project.scenes.map((_,i)=>"[v"+i+"]").join("")+"concat=n="+project.scenes.length+":v=1:a=0[v]";
  args.push("-filter_complex",filters+";"+concat,"-map","[v]","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart","-y",out);await this.run(ffmpeg,args,180000);project.outputPath=out;this.save(project);return project;
 }
 async doctor():Promise<CreatorDoctorReport>{const ffmpeg=await commandExists(process.env.LAYANX_FFMPEG_PATH??"ffmpeg");return{ready:ffmpeg,providers:[{name:"local-llm",available:Boolean(process.env.OLLAMA_HOST||this.options.generateText),mode:"local",reason:(process.env.OLLAMA_HOST||this.options.generateText)?"configured":"no local LLM callback configured"},{name:"tts-command",available:Boolean(process.env.LAYANX_TTS_EXECUTABLE),mode:"command",reason:process.env.LAYANX_TTS_EXECUTABLE?"configured":"optional; configure a local TTS executable"},{name:"comfyui",available:Boolean(process.env.LAYANX_COMFYUI_URL),mode:"http",reason:process.env.LAYANX_COMFYUI_URL?"configured":"optional; configure ComfyUI later"}],ffmpeg,outputDir:this.root};}
 private run(command:string,args:string[],timeoutMs:number){return new Promise<void>((resolveResult,reject)=>{const child=spawn(command,args,{stdio:["ignore","pipe","pipe"]});let stderr="";const timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error("creator_command_timeout"));},timeoutMs);child.stderr.on("data",d=>{stderr+=String(d).slice(-4000);});child.on("error",e=>{clearTimeout(timer);reject(e);});child.on("close",code=>{clearTimeout(timer);if(code===0)resolveResult();else reject(new Error("creator_ffmpeg_failed:"+code+":"+stderr.slice(-1200)));});});}
}