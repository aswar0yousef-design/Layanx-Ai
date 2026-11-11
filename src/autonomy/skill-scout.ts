import {createHash} from "node:crypto";
import {scanPlaybook,tokens} from "./learning.js";

/**
 * Finds skills other people published. Only the text of one SKILL.md is downloaded, at one exact commit, and nothing from a
 * repository is cloned or run. A skill that comes with scripts, asks to install software, or concerns money is not taken
 * automatically: it is listed for the owner. What is taken is only a candidate until the benchmark has judged it.
 */
export interface ScoutClient{json:(url:string)=>Promise<any>;text:(url:string)=>Promise<string>}
export interface SkillCandidate{topic:string;repo:string;commit:string;path:string;license:string;stars:number;name:string;description:string;body:string;sha256:string}
export interface SkillPassedOver{repo:string;path:string;why:string}
export interface ScoutResult{candidates:SkillCandidate[];held:SkillPassedOver[];refused:SkillPassedOver[];problem?:string}

/** Every field LayanX works in, and the general ones it should grow into. One group is studied per day, in turn. */
export const LEARNING_FIELDS:string[][]=[
  ["software testing","debugging","code review"],["web development","frontend design","accessibility"],["backend api design","database design","software architecture"],
  ["security review","devops deployment","monitoring"],["windows automation","browser automation","mobile android"],["ecommerce store","woocommerce","product catalog"],
  ["shipping logistics","inventory management","supply chain"],["customer support","whatsapp messaging","sales conversation"],["digital marketing","social media","seo"],
  ["copywriting","arabic writing","translation"],["graphic design","video production","presentation"],["data analysis","spreadsheets","data visualization"],
  ["accounting invoices","business planning","project management"],["research methods","technical writing","prompt engineering"],["trading risk management","technical analysis","market research"]
];
const PERMISSIVE=/^(?:MIT|Apache-2\.0|BSD-[23]-Clause|ISC|CC0-1\.0|CC-BY-4\.0|Unlicense|0BSD|MPL-2\.0)$/;
const MIN_STARS=25,MAX_AGE_DAYS=540,MAX_REPOS=4,MAX_SKILLS_PER_REPO=3,MAX_BYTES=48_000;
const MONEY=/\b(?:trading|forex|crypto|invest\w*|binance|mt5|bitcoin|technical analysis|market research)\b/i;
const NEEDS_CODE=/\b(?:npm|pnpm|yarn|npx|pip3?|uvx|brew|apt(?:-get)?|winget|choco)\s+(?:install|i|add|exec|run)\b|\bscripts?\/\S+\.(?:py|sh|js|mjs|ts|ps1)\b|\bpython3?\s+\S+\.py\b/i;

/** What the work has been failing at comes first, then what the owner has been asking for, then the next field in turn. */
export function pickTopics(failures:string[],recentGoals:string[],day:number,count=3):string[]{
  // Only these fixed subjects are ever searched for, so nothing the owner wrote leaves the machine.
  const fromGoals=LEARNING_FIELDS.flat().filter(subject=>recentGoals.some(goal=>{const words=new Set(tokens(goal));return tokens(subject).some(word=>words.has(word));}));
  const field=LEARNING_FIELDS[((day%LEARNING_FIELDS.length)+LEARNING_FIELDS.length)%LEARNING_FIELDS.length]!;
  return[...new Set([...failures.slice(0,1),...fromGoals.slice(0,1),...field])].slice(0,count);
}
function frontmatter(raw:string):{name:string;description:string}{
  const head=/^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1]??"";
  const field=(key:string)=>new RegExp("^"+key+":\\s*(.+)$","m").exec(head)?.[1]?.trim().replace(/^["']|["']$/g,"")??"";
  return{name:field("name"),description:field("description")};
}
const overlap=(topic:string,text:string)=>{const have=new Set(tokens(text.replace(/[-_/]/g," ")));return tokens(topic).filter(word=>have.has(word)).length;};
/** Why this text must not be taken by itself, if it must not. Undefined means it may become a candidate. */
export function skillTextRefusal(text:string):{refuse?:string;hold?:string}{
  const unsafe=scanPlaybook(text);
  if(unsafe.length)return{refuse:unsafe.join(", ")};
  if(NEEDS_CODE.test(text))return{hold:"It asks to install or run software."};
  return{};
}
export async function scoutSkills(topic:string,client:ScoutClient,now:Date=new Date(),seen:Set<string>=new Set()):Promise<ScoutResult>{
  const result:ScoutResult={candidates:[],held:[],refused:[]};
  let found:any;
  try{found=await client.json(`https://api.github.com/search/repositories?q=${encodeURIComponent(topic+" agent skills in:name,description,readme")}&per_page=15`);}
  catch(error){return{...result,problem:(error as Error).message.slice(0,200)};}
  const usable=(found?.items??[]).filter((repo:any)=>!repo.fork&&!repo.archived&&repo.stargazers_count>=MIN_STARS&&PERMISSIVE.test(repo.license?.spdx_id??"")&&(now.getTime()-Date.parse(repo.pushed_at))/86_400_000<=MAX_AGE_DAYS).slice(0,MAX_REPOS);
  for(const repo of usable){
    try{
      const commit=(await client.json(`https://api.github.com/repos/${repo.full_name}/commits/${encodeURIComponent(repo.default_branch)}`))?.sha;
      if(!/^[a-f0-9]{40}$/.test(commit??""))continue;
      const entries:Array<{path:string;type:string}>=(await client.json(`https://api.github.com/repos/${repo.full_name}/git/trees/${commit}?recursive=1`))?.tree??[];
      const skills=entries.filter(entry=>entry.type==="blob"&&/(?:^|\/)SKILL\.md$/i.test(entry.path)&&entry.path.includes("/"))
        .map(entry=>({path:entry.path,score:overlap(topic,entry.path)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,MAX_SKILLS_PER_REPO);
      for(const skill of skills){
        const folder=skill.path.slice(0,skill.path.lastIndexOf("/")+1);
        const hold=(why:string)=>result.held.push({repo:repo.full_name,path:skill.path,why});
        if(entries.some(entry=>entry.type==="blob"&&entry.path.startsWith(folder)&&entry.path!==skill.path&&!/\.(?:md|txt)$/i.test(entry.path))){hold("It comes with scripts or other files.");continue;}
        const raw=await client.text(`https://raw.githubusercontent.com/${repo.full_name}/${commit}/${skill.path.split("/").map(encodeURIComponent).join("/")}`);
        const sha256=createHash("sha256").update(raw).digest("hex");
        if(seen.has(sha256))continue;
        if(Buffer.byteLength(raw)>MAX_BYTES){result.refused.push({repo:repo.full_name,path:skill.path,why:"Too large to be a skill."});continue;}
        const verdict=skillTextRefusal(raw);
        if(verdict.refuse){result.refused.push({repo:repo.full_name,path:skill.path,why:verdict.refuse});continue;}
        if(verdict.hold){hold(verdict.hold);continue;}
        const meta=frontmatter(raw);
        if(MONEY.test(topic+" "+meta.name+" "+meta.description)){hold("It concerns money, so the owner decides.");continue;}
        result.candidates.push({topic,repo:repo.full_name,commit,path:skill.path,license:repo.license.spdx_id,stars:repo.stargazers_count,name:(meta.name||folder.split("/").at(-2)||topic).slice(0,80),description:meta.description.slice(0,300),body:raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,"").trim(),sha256});
      }
    }catch(error){result.problem=(error as Error).message.slice(0,200);}
  }
  result.candidates.sort((a,b)=>overlap(topic,b.name+" "+b.description)-overlap(topic,a.name+" "+a.description)||b.stars-a.stars);
  return result;
}
const HEADERS={"user-agent":"skill-scout","accept":"application/vnd.github+json"};
export function gitHubClient(fetcher:typeof fetch=fetch,token?:string):ScoutClient{
  const get=async(url:string)=>{
    const response=await fetcher(url,{headers:{...HEADERS,...(token&&url.startsWith("https://api.github.com/")?{authorization:"Bearer "+token}:{})},signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw new Error(`GitHub answered ${response.status}`);
    return response;
  };
  return{json:async url=>(await get(url)).json(),text:async url=>(await get(url)).text()};
}
