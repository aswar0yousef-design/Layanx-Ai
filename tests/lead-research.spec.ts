import assert from "node:assert/strict";
import {findLeads,leadRequest,siteFrom,siteText,readSite} from "../src/business/lead-research.js";

// The owner's request from 2026-11-12: the agent guessed what layanx.com does from its name and listed no real companies.
assert.ok(leadRequest("ابحث لي عن عملاء محتملين لموقع layanx.com"));
assert.ok(leadRequest("find leads for https://www.example.co/about"));
assert.ok(!leadRequest("ابحث لي عن عملاء محتملين"),"no site named: left to the planner");
assert.ok(!leadRequest("افتح layanx.com"));
assert.equal(siteFrom("ابحث لي عن عملاء محتملين لموقع layanx.com"),"https://layanx.com");
assert.equal(siteFrom({site:"https://www.Example.co/about"}),"https://www.example.co/about");
assert.equal(siteFrom({query:"no site here"}),null);
assert.match(siteText('<title>LayanX</title><meta name="description" content="Logistics OS for MENA"><script>x=1</script><p>Ship &amp; track</p>'),/LayanX Logistics OS for MENA Ship & track/);

const hits:Record<string,Array<{title:string;url:string;snippet:string}>>={
  "e-commerce companies Saudi Arabia":[
    {title:"Noon Fashion Store - Online shopping KSA",url:"https://noonfashion.example/",snippet:"Online fashion retailer in Riyadh"},
    {title:"Top 50 e-commerce companies in Saudi Arabia",url:"https://www.linkedin.com/pulse/top-50",snippet:"list"},
    {title:"LayanX - logistics",url:"https://layanx.com/",snippet:"own site"}
  ],
  "freight forwarders UAE":[
    {title:"Freight forwarders in Egypt",url:"https://forwardingcompanies.example/in/egypt",snippet:"directory of forwarders"},
    {title:"Gulf Cargo Movers | Freight forwarding Dubai",url:"https://gulfcargo.example/",snippet:"Freight forwarder in Dubai"},
    {title:"INFINIDIS Express digital delivery Morocco",url:"https://atlaexpress.example/",snippet:"delivery platform"}
  ]
};
const prompts:string[]=[];
const think=async(prompt:string)=>{
  prompts.push(prompt);
  if(prompts.length===1)return JSON.stringify({business:"A logistics operating system for shippers in MENA",region:"MENA",segments:[
    {name:"Online stores",why:"they ship orders daily",searches:["e-commerce companies Saudi Arabia","layanx competitors"]},
    {name:"Freight forwarders",why:"they manage shipments",searches:["best freight forwarders UAE list"]}]});
  // Real results, an invented company, a name not in its result, and a name whose link is another company's site
  // (seen live: "INFINIDIS Express" pointing at atlaexpress.com, matched only on the word "express").
  return JSON.stringify({leads:[{n:1,name:"Noon Fashion Store",segment:"Online stores",why:"ships orders"},{n:9,name:"Invented Co"},{n:2,name:"Acme Logistics"},{n:2,name:"Gulf Cargo Movers",segment:"Freight forwarders"},{n:3,name:"INFINIDIS Express"}]});
};
const report=await findLeads({site:"https://layanx.com",request:"ابحث لي عن عملاء محتملين لموقع layanx.com"},{
  think,read:async()=>"LayanX is a logistics operating system for MENA shippers: quotes, bookings, tracking and COD.",
  search:async q=>hits[q]??[]
});
assert.match(prompts[0]!,/logistics operating system/,"the customer types are worked out from the site's own text");
assert.deepEqual(report.searched,["e-commerce companies Saudi Arabia","freight forwarders UAE"],"a search naming the site itself is dropped; list words are removed");
assert.match(prompts[0]!,/not lists of them/);
assert.deepEqual(report.leads.map(l=>[l.name,l.url]),[["Noon Fashion Store","https://noonfashion.example/"],["Gulf Cargo Movers","https://gulfcargo.example/"]],"only companies really in the results, at their own sites");
assert.ok(!prompts[1]!.includes("forwardingcompanies"),"a page listing many companies is not offered as a lead");
assert.ok(!prompts[1]!.includes("linkedin")&&!prompts[1]!.includes("layanx.com/"),"directories and the site itself are not offered as leads");
assert.equal(report.business,"A logistics operating system for shippers in MENA");

// A site that does not say what it does: no guessing.
const vague=await findLeads({site:"https://x.example"},{think:async()=>'{"business":"","segments":[]}',read:async()=>"Welcome to our website. Coming soon, stay tuned for more."});
assert.equal(vague.leads.length,0);
assert.match(vague.note!,/did not say clearly/);
await assert.rejects(findLeads({site:"https://x.example"},{think,read:async()=>"Hi"}),/almost no readable text/);

// Redirects are followed only to public addresses.
const redirecting=(async(url:string)=>String(url)==="https://layanx.com"?new Response("",{status:301,headers:{location:"https://www.layanx.com/"}}):new Response("<title>LayanX</title>",{status:200,headers:{"content-type":"text/html"}})) as unknown as typeof fetch;
assert.equal(await readSite("https://layanx.com",redirecting),"LayanX");
const toLan=(async()=>new Response("",{status:302,headers:{location:"http://192.168.1.1/"}})) as unknown as typeof fetch;
await assert.rejects(readSite("https://layanx.com",toLan),/not a public address/);

// The planner sends the request to this tool in one step, without asking a model.
const {AiMissionPlanner}=await import("../src/core/ai-planner.js");
const planner=new AiMissionPlanner({execute:async()=>{throw new Error("no model needed");}} as never);
const tool={name:"research.leads",permission:"L2_ANALYZE",actions:["find leads"],tags:["leads"],description:"find leads",dangerous:false};
const mission=await planner.plan("ابحث لي عن عملاء محتملين لموقع layanx.com",[tool] as never);
assert.equal(mission.tools.length,1);
assert.equal(mission.tools[0]!.tool,"research.leads");
assert.equal((mission.tools[0]!.payload as {site:string}).site,"https://layanx.com");
assert.equal(mission.tools[0]!.final,true);
// The reply lists exactly the checked companies, written by code (seen live: the model echoed the JSON back).
const {leadsReply,composeTaskAnswer}=await import("../src/core/task-answer.js");
const reply=leadsReply(report,true)!;
assert.match(reply,/Noon Fashion Store \(Online stores\): https:\/\/noonfashion.example\//);
assert.match(reply,/لم أتواصل مع أحد/);
assert.ok(!reply.trim().startsWith("{"));
const noModel={execute:async()=>{throw new Error("must not be asked");}};
assert.equal((await composeTaskAnswer(noModel as never,"ابحث عن عملاء",[{ok:true,tool:"research.leads",data:report}],true))!.text,reply);
assert.match(leadsReply(vague,true)!,/لم أجد شركات بعينها/);
console.log("lead-research: reads the site, works out customer types, and lists only companies found in the search results");
