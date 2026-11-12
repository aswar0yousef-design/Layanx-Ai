import fs from "node:fs";
import path from "node:path";
import {writeFileAtomic} from "../platform/paths.js";
import {scanPlaybook,tokens} from "./learning.js";
import {gitHubClient,LEARNING_FIELDS,type ScoutClient} from "./skill-scout.js";
import {decideIntake,listIntake,requestIntake,type IntakeRecord} from "./integration-intake.js";

/**
 * The owner's idea (2026-11-12): LayanX looks on GitHub for popular new projects, reviews them, prepares the good ones, and
 * asks the owner to approve or reject each. Nothing is installed or run here: a project is read through the GitHub API,
 * the best few are fetched at one exact commit into the existing quarantine and scanned, and only the owner's decision
 * moves one further. Only fixed search words leave the machine, never anything the owner wrote.
 */
export type ProjectKind="mcp"|"skills"|"tool";
export type ProposalStatus="proposed"|"awaiting_owner"|"held"|"refused"|"approved"|"rejected";
export interface ProjectProposal{
  id:string;repo:string;url:string;commit:string;stars:number;license:string;pushedAt:string;createdAt:string;
  kind:ProjectKind;description:string;why:string;risks:string[];score:number;
  npm?:{name:string;version:string};status:ProposalStatus;intakeId?:string;findings?:IntakeRecord["findings"];decidedAt?:string;next?:string;foundAt:string;
}
export interface ScoutLedger{lastRun?:string;proposals:ProjectProposal[]}

const PERMISSIVE=/^(?:MIT|Apache-2\.0|BSD-[23]-Clause|ISC|CC0-1\.0|Unlicense|0BSD|MPL-2\.0)$/;
const MIN_STARS=200,MAX_PUSH_AGE_DAYS=90,MAX_REVIEW=8,PREPARE=3;
const MONEY=/\b(?:trading|forex|crypto\w*|invest\w*|binance|mt5|bitcoin|defi|wallet)\b/i;
const MCP=/\b(?:mcp|model context protocol)\b/i;
const LIFECYCLE=["preinstall","install","postinstall","prepare"];
/** The searches: always MCP servers and agents, plus one of LayanX's fields, in turn by day. */
export function scoutQueries(now:Date,day=Math.floor(now.getTime()/86_400_000)):string[]{
  const since=new Date(now.getTime()-MAX_PUSH_AGE_DAYS*86_400_000).toISOString().slice(0,10);
  const field=LEARNING_FIELDS[((day%LEARNING_FIELDS.length)+LEARNING_FIELDS.length)%LEARNING_FIELDS.length]!;
  return["topic:mcp-server","topic:ai-agents",...field.slice(0,1).map(f=>`"${f}"`)].map(q=>`${q} stars:>=${MIN_STARS} pushed:>=${since} fork:false archived:false`);
}
const days=(from:string,now:Date)=>Math.max(1,(now.getTime()-Date.parse(from))/86_400_000);
/** Popular for its age, and close to what LayanX does. */
export function scoreRepo(repo:{stargazers_count:number;created_at:string;description?:string|null;topics?:string[];full_name:string},now:Date):number{
  const perDay=repo.stargazers_count/days(repo.created_at,now);
  const words=new Set(tokens([repo.full_name.replace(/[/_-]/g," "),repo.description??"",...(repo.topics??[])].join(" ")));
  const relevant=LEARNING_FIELDS.flat().filter(f=>tokens(f).some(w=>words.has(w))).length+(MCP.test([repo.description,...(repo.topics??[])].join(" "))?3:0);
  return Math.round((Math.log10(1+repo.stargazers_count)*10+Math.min(30,perDay)+relevant*4)*10)/10;
}

export async function scoutProjects(input:{client?:ScoutClient;now?:Date;seen?:Set<string>}={}):Promise<{proposals:ProjectProposal[];problem?:string}>{
  const client=input.client??gitHubClient(),now=input.now??new Date(),seen=input.seen??new Set<string>();
  const found=new Map<string,any>();let problem:string|undefined;
  for(const q of scoutQueries(now)){
    try{for(const repo of (await client.json(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`))?.items??[])found.set(repo.full_name,repo);}
    catch(error){problem=(error as Error).message.slice(0,200);}
  }
  const usable=[...found.values()].filter(repo=>!repo.fork&&!repo.archived&&!seen.has(repo.full_name)&&repo.stargazers_count>=MIN_STARS&&PERMISSIVE.test(repo.license?.spdx_id??"")&&days(repo.pushed_at,now)<=MAX_PUSH_AGE_DAYS)
    .map(repo=>({repo,score:scoreRepo(repo,now)})).sort((a,b)=>b.score-a.score).slice(0,MAX_REVIEW);
  const proposals:ProjectProposal[]=[];
  for(const{repo,score}of usable){
    try{proposals.push(await reviewRepo(repo,score,client,now));}catch(error){problem=(error as Error).message.slice(0,200);}
  }
  return{proposals,...(problem?{problem}:{})};
}

/** Read, never run: the exact commit, its package.json and README, and what kind of thing it is. */
export async function reviewRepo(repo:any,score:number,client:ScoutClient,now:Date):Promise<ProjectProposal>{
  const commit=(await client.json(`https://api.github.com/repos/${repo.full_name}/commits/${encodeURIComponent(repo.default_branch)}`))?.sha;
  if(!/^[a-f0-9]{40}$/.test(commit??""))throw new Error("no exact commit for "+repo.full_name);
  const raw=(file:string)=>client.text(`https://raw.githubusercontent.com/${repo.full_name}/${commit}/${file}`).catch(()=>"");
  const tree:Array<{path:string;type:string}>=(await client.json(`https://api.github.com/repos/${repo.full_name}/git/trees/${commit}?recursive=1`).catch(()=>({tree:[]})))?.tree??[];
  const readme=(await raw("README.md")).slice(0,60_000);
  let pkg:any=null;try{const text=await raw("package.json");pkg=text?JSON.parse(text):null;}catch{pkg=null;}
  const risks:string[]=[];
  const lifecycle=LIFECYCLE.filter(k=>typeof pkg?.scripts?.[k]==="string");
  if(lifecycle.length)risks.push("Runs scripts when installed: "+lifecycle.join(", "));
  for(const issue of scanPlaybook(readme))risks.push("README: "+issue);
  if(/(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z)?sh\b|iwr\b[^\n|]*\|\s*iex\b/i.test(readme))risks.push("README tells you to pipe a download into a shell");
  const text=[repo.full_name,repo.description??"",...(repo.topics??[]),readme.slice(0,3000)].join(" ");
  const hasSkills=tree.some(e=>e.type==="blob"&&/(?:^|\/)SKILL\.md$/i.test(e.path));
  const kind:ProjectKind=MCP.test([repo.description,...(repo.topics??[])].join(" "))||/@modelcontextprotocol\/sdk|"mcp"/.test(JSON.stringify(pkg?.dependencies??{}))?"mcp":hasSkills?"skills":"tool";
  const npm=pkg&&typeof pkg.name==="string"&&typeof pkg.version==="string"&&!pkg.private&&/^\d+\.\d+\.\d+$/.test(pkg.version)?{name:pkg.name,version:pkg.version}:undefined;
  if(MONEY.test(text))risks.push("It concerns money or trading, so you decide without a recommendation");
  const age=Math.round(days(repo.created_at,now));
  const why=`${repo.stargazers_count.toLocaleString("en")} stars in ${age} days, updated ${Math.round(days(repo.pushed_at,now))} days ago`+(kind==="mcp"?"; an MCP server LayanX could use as tools":kind==="skills"?"; contains skills (SKILL.md) LayanX could learn from":"");
  return{id:repo.full_name.replace(/[^\w.-]+/g,"__")+"@"+commit.slice(0,7),repo:repo.full_name,url:repo.html_url??`https://github.com/${repo.full_name}`,commit,stars:repo.stargazers_count,license:repo.license?.spdx_id??"",
    pushedAt:repo.pushed_at,createdAt:repo.created_at,kind,description:String(repo.description??"").slice(0,300),why,risks,score,...(npm?{npm}:{}),
    status:MONEY.test(text)||risks.some(r=>/pipe a download|README:/.test(r))?"held":"proposed",foundAt:now.toISOString()};
}

export const ledgerFile=(store:string)=>path.join(store,"project-scout.json");
export function readScoutLedger(store:string):ScoutLedger{try{const d=JSON.parse(fs.readFileSync(ledgerFile(store),"utf8"));return{lastRun:d.lastRun,proposals:Array.isArray(d.proposals)?d.proposals:[]};}catch{return{proposals:[]};}}
const saveLedger=(store:string,ledger:ScoutLedger)=>{fs.mkdirSync(store,{recursive:true});writeFileAtomic(ledgerFile(store),JSON.stringify(ledger,null,2));};

/**
 * One scouting run: find, review, and prepare the best few in quarantine (fetched at the exact commit and scanned, not run).
 * Held projects (money, a README that pipes downloads into a shell) are listed but not prepared.
 */
export async function runProjectScout(store:string,deps:{client?:ScoutClient;now?:Date;intakeRoot:string;prepare?:typeof requestIntake}):Promise<ScoutLedger&{problem?:string}>{
  const ledger=readScoutLedger(store),now=deps.now??new Date();
  const seen=new Set(ledger.proposals.map(p=>p.repo));
  const found=await scoutProjects({...(deps.client?{client:deps.client}:{}),now,seen});
  const prepare=deps.prepare??requestIntake;
  // Count only projects that passed the scan: seen live, the first three were refused and the best two were never prepared.
  let prepared=0,tried=0;
  for(const proposal of found.proposals){
    if(proposal.status==="proposed"&&prepared<PREPARE&&tried<MAX_REVIEW){
      tried++;
      await prepareProposal(proposal,deps.intakeRoot,prepare);
      if((proposal.status as ProposalStatus)==="awaiting_owner")prepared++;
    }
    ledger.proposals.push(proposal);
  }
  ledger.proposals=ledger.proposals.slice(-200);ledger.lastRun=now.toISOString();
  saveLedger(store,ledger);
  return{...ledger,...(found.problem?{problem:found.problem}:{})};
}

/** Fetch at the exact commit into quarantine and scan it; nothing in it runs. */
async function prepareProposal(proposal:ProjectProposal,intakeRoot:string,prepare:typeof requestIntake=requestIntake):Promise<void>{
  try{
    const record=await prepare({source:"git",target:proposal.url.replace(/\/?$/,".git").replace(/\.git\.git$/,".git"),ref:proposal.commit,why:`Project scout: ${proposal.why}`},{root:intakeRoot});
    proposal.intakeId=record.id;proposal.findings=record.findings;
    proposal.status=record.status==="awaiting_owner"?"awaiting_owner":"refused";
    const high=record.findings.filter(f=>f.severity==="high");
    if(high.length)proposal.risks.push("The scan found: "+[...new Set(high.map(f=>f.issue))].join(", "));
    if(record.status!=="awaiting_owner"&&record.reason)proposal.risks.push(record.reason);
  }catch(error){proposal.status="refused";proposal.risks.push("Could not be prepared: "+(error as Error).message.slice(0,160));}
}

/** What approval leads to: nothing runs here. An MCP server is added to the MCP list switched off; skills become candidates. */
export interface ScoutIntegrations{addMcpServer?:(config:Record<string,unknown>)=>unknown;adoptSkills?:(intakeId:string,skills:string[])=>unknown}
export async function decideProposal(store:string,intakeRoot:string,id:string,decision:"approved"|"rejected",integrations:ScoutIntegrations={},now=new Date(),prepare:typeof requestIntake=requestIntake):Promise<ProjectProposal>{
  const ledger=readScoutLedger(store),proposal=ledger.proposals.find(p=>p.id===id);
  if(!proposal)throw new Error("scout_proposal_not_found");
  if(proposal.status!=="awaiting_owner"&&proposal.status!=="proposed"&&proposal.status!=="held")throw new Error("scout_proposal_already_decided");
  // Approving something not yet prepared scans it first: an approval never skips the scan.
  if(decision==="approved"&&!proposal.intakeId){
    await prepareProposal(proposal,intakeRoot,prepare);
    if(proposal.status!=="awaiting_owner"){proposal.decidedAt=now.toISOString();proposal.next="Not approved: the scan refused it.";saveLedger(store,ledger);return proposal;}
  }
  if(proposal.intakeId)decideIntake(intakeRoot,proposal.intakeId,decision);
  proposal.status=decision;proposal.decidedAt=now.toISOString();
  if(decision==="approved"){
    const intake=proposal.intakeId?listIntake(intakeRoot).find(r=>r.id===proposal.intakeId):undefined;
    if(intake&&intake.status!=="approved"){proposal.status="refused";proposal.next=intake.reason??"The quarantine copy changed after it was scanned.";}
    else if(proposal.kind==="mcp"&&proposal.npm&&integrations.addMcpServer){
      const serverId=proposal.npm.name.replace(/^@/,"").replace(/[^\w-]+/g,"-").slice(0,40);
      try{integrations.addMcpServer({id:serverId,name:proposal.repo,transport:"stdio",command:"npx",args:["-y",`${proposal.npm.name}@${proposal.npm.version}`],source:{package:proposal.npm.name}});
        proposal.next=`Added to the MCP list as "${serverId}", switched off. Turn it on there to run it.`;}
      catch(error){proposal.next="Approved, but it could not be added to the MCP list: "+(error as Error).message.slice(0,160);}
    }else if(proposal.kind==="skills"&&intake?.skills.length&&integrations.adoptSkills){
      integrations.adoptSkills(intake.id,intake.skills);
      proposal.next=`${intake.skills.length} skill(s) became candidates; each is used only after it wins on the benchmark.`;
    }else proposal.next="Approved and kept in quarantine as reference code for LayanX's coding work.";
  }
  saveLedger(store,ledger);
  return proposal;
}

/** Once a day while LayanX runs, unless LAYANX_PROJECT_SCOUT=off. */
export function scoutDue(store:string,now=new Date(),env:NodeJS.ProcessEnv=process.env):boolean{
  if((env.LAYANX_PROJECT_SCOUT??"").toLowerCase()==="off")return false;
  const last=readScoutLedger(store).lastRun;
  return!last||now.getTime()-Date.parse(last)>=20*3600_000;
}
