import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {goalFromPrompt,projectIdFor,toolKind} from "../src/acp/agent.js";

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")),"..");

// 1. Pure helpers.
assert.equal(projectIdFor("C:\\Users\\me\\Projects\\My Shop\\"),"my-shop");
assert.equal(projectIdFor("/home/me/code/blog_v2"),"blog_v2");
assert.equal(toolKind("files.read"),"read");assert.equal(toolKind("files.write"),"edit");assert.equal(toolKind("project.run"),"execute");
assert.equal(toolKind("research.internet"),"search");assert.equal(toolKind("browser.read"),"fetch");assert.equal(toolKind("ads.snapshot"),"other");
const g=goalFromPrompt([{type:"text",text:"Fix the login bug"},{type:"resource_link",uri:"file:///p/src/login.ts",name:"login.ts"},{type:"resource",resource:{uri:"file:///p/a.ts",text:"export const a=1;"}}],"/p");
assert.match(g,/^Fix the login bug\n\n\[file: login.ts\] file:\/\/\/p\/src\/login.ts\n\nFile file:\/\/\/p\/a.ts:\nexport const a=1;/);
assert.match(g,/Project folder: \/p/);
assert.ok(goalFromPrompt([{type:"text",text:"x".repeat(9000)}],"/p").length<=4000,"fits the mission API limit");

// 2. The real entry point over stdio against a LayanX stand-in.
type Call={method:string;url:string;body:any;auth?:string};
const calls:Call[]=[];
let scenario:"approve"|"decline"|"cancel"="approve";let loops=0;
const events:Array<Record<string,unknown>>=[];
const mission={id:"m1",steps:[{description:"Read the file"},{description:"Write the fix"}],tools:[{tool:"files.read",action:"read file"},{tool:"files.write",action:"write file",reason:"apply the fix",payload:{path:"a.txt"}}]};
const layanx=http.createServer((req,res)=>{
  let raw="";req.on("data",c=>raw+=c);req.on("end",async()=>{
    const url=req.url??"";const body=raw?JSON.parse(raw):undefined;
    calls.push({method:req.method??"",url,body,auth:req.headers.authorization});
    const send=(status:number,data:unknown)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(data));};
    if(req.headers.authorization!=="Bearer test-token")return send(401,{error:"unauthorized"});
    if(url==="/v1/projects/link")return send(200,{ok:true});
    if(url==="/v1/missions"&&req.method==="POST"){loops=0;events.length=0;return send(201,{ok:true,mission});}
    if(url.startsWith("/v1/missions/m1/events"))return send(200,{ok:true,events});
    if(url.startsWith("/v1/missions/m1?"))return send(200,{ok:true,mission});
    if(url==="/v1/missions/m1/agent-loop"){
      loops++;
      if(loops===1){
        events.push({id:"e1",type:"tool.started",tool:"files.read",action:"read file",stepIndex:0});
        if(scenario==="cancel"){await new Promise(r=>setTimeout(r,4000));return send(200,{completed:false,status:"cancelled"});}
        await new Promise(r=>setTimeout(r,250));
        events.push({id:"e2",type:"tool.completed",tool:"files.read",action:"read file",stepIndex:0});
        return send(202,{ok:true,completed:false,paused:true,status:"awaiting_approval",approvalId:"ap1",nextToolIndex:1});
      }
      events.push({id:"e3",type:"tool.completed",tool:"files.write",action:"write file",stepIndex:1});
      return send(200,{completed:true,status:"completed",final:{data:{written:"a.txt"}}});
    }
    if(/^\/v1\/approvals\/ap1\/(approve|revoke)/.test(url))return send(200,{ok:true});
    if(url==="/v1/missions/m1/cancel")return send(200,{ok:true});
    send(404,{error:"not_found"});
  });
});
await new Promise<void>(r=>layanx.listen(0,"127.0.0.1",()=>r()));
const port=(layanx.address() as {port:number}).port;
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-acp-"));
const child=spawn(process.execPath,[path.join(root,"node_modules","tsx","dist","cli.mjs"),path.join(root,"src","acp","main.ts")],
  {cwd:os.tmpdir(),env:{...process.env,LAYANX_URL:`http://127.0.0.1:${port}`,LAYANX_API_TOKEN:"test-token",LAYANX_DATA_DIR:dataDir},stdio:["pipe","pipe","pipe"]});
const received:any[]=[];let stdoutRaw="";let stderr="";
child.stderr.on("data",d=>stderr+=d);
child.stdout.setEncoding("utf8").on("data",(d:string)=>{stdoutRaw+=d;let i;while((i=stdoutRaw.indexOf("\n"))>=0){const line=stdoutRaw.slice(0,i);stdoutRaw=stdoutRaw.slice(i+1);if(line.trim())received.push(JSON.parse(line));}});
const write=(m:unknown)=>child.stdin.write(JSON.stringify(m)+"\n");
const waitFor=async(pred:(m:any)=>boolean,what:string,ms=20000)=>{const end=Date.now()+ms;for(;;){const m=received.find(pred);if(m)return m;if(Date.now()>end)throw new Error("timeout waiting for "+what+"; got "+JSON.stringify(received).slice(-1500)+" stderr "+stderr.slice(-500));await new Promise(r=>setTimeout(r,20));}};

write({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:1,clientCapabilities:{fs:{readTextFile:true,writeTextFile:true},terminal:true},clientInfo:{name:"zed",version:"1"}}});
const init=await waitFor(m=>m.id===1,"initialize");
assert.equal(init.result.protocolVersion,1);assert.equal(init.result.agentInfo.name,"layanx");
assert.equal(init.result.agentCapabilities.promptCapabilities.embeddedContext,true);assert.deepEqual(init.result.authMethods,[]);

const cwd=path.join(os.tmpdir(),"My Shop");
write({jsonrpc:"2.0",id:2,method:"session/new",params:{cwd,mcpServers:[{name:"x",command:"evil.exe",args:[],env:[]}]}});
const session=(await waitFor(m=>m.id===2,"session/new")).result.sessionId;
assert.match(session,/^lx_/);
assert.deepEqual(calls.find(c=>c.url==="/v1/projects/link")!.body,{projectId:"my-shop",path:cwd});
assert.match(stderr,/ignoring 1 MCP server/);

// Approve path: plan -> tool calls -> permission prompt -> approve -> done.
write({jsonrpc:"2.0",id:3,method:"session/prompt",params:{sessionId:session,prompt:[{type:"text",text:"Fix the typo in a.txt"}]}});
const perm=await waitFor(m=>m.method==="session/request_permission","permission request");
assert.equal(perm.params.toolCall.title,"files.write (write file): apply the fix");
assert.equal(perm.params.toolCall.kind,"edit");assert.deepEqual(perm.params.toolCall.rawInput,{path:"a.txt"});
assert.deepEqual(perm.params.options.map((o:any)=>o.kind),["allow_once","reject_once"],"no 'allow always': trust levels stay on the setup page");
write({jsonrpc:"2.0",id:perm.id,result:{outcome:{outcome:"selected",optionId:"approve"}}});
const done=await waitFor(m=>m.id===3,"prompt result");
assert.equal(done.result.stopReason,"end_turn");
const updates=received.filter(m=>m.method==="session/update").map(m=>m.params.update);
assert.deepEqual(updates.find(u=>u.sessionUpdate==="plan").entries.map((e:any)=>e.content),["Read the file","Write the fix"]);
assert.ok(updates.some(u=>u.sessionUpdate==="tool_call"&&u.title.startsWith("files.read")&&u.kind==="read"));
assert.ok(updates.some(u=>u.sessionUpdate==="tool_call_update"&&u.toolCallId==="m1:0"&&u.status==="completed"));
assert.match(updates.filter(u=>u.sessionUpdate==="agent_message_chunk").at(-1).content.text,/^Done\.[\s\S]*a\.txt/);
assert.ok(calls.some(c=>c.url.startsWith("/v1/approvals/ap1/approve?projectId=my-shop")));
assert.deepEqual(calls.filter(c=>c.url==="/v1/missions/m1/agent-loop").map(c=>c.body.approvalIds),[{},{"1":"ap1"}],"the second loop carries the approval");
assert.match(calls.find(c=>c.url==="/v1/missions")!.body.goal,/^Fix the typo in a.txt\n[\s\S]*Editor context/);

// Decline path.
scenario="decline";received.length=0;
write({jsonrpc:"2.0",id:4,method:"session/prompt",params:{sessionId:session,prompt:[{type:"text",text:"Fix it again"}]}});
const perm2=await waitFor(m=>m.method==="session/request_permission","second permission request");
write({jsonrpc:"2.0",id:perm2.id,result:{outcome:{outcome:"selected",optionId:"decline"}}});
const declined=await waitFor(m=>m.id===4,"declined result");
assert.equal(declined.result.stopReason,"end_turn");
assert.ok(calls.some(c=>c.url.startsWith("/v1/approvals/ap1/revoke")),"declined approval is revoked in LayanX");
assert.ok(received.some(m=>m.method==="session/update"&&/you declined/.test(m.params.update.content?.text??"")));

// Cancel while the mission runs.
scenario="cancel";received.length=0;
write({jsonrpc:"2.0",id:5,method:"session/prompt",params:{sessionId:session,prompt:[{type:"text",text:"Long task"}]}});
await waitFor(m=>m.method==="session/update"&&m.params.update.sessionUpdate==="tool_call","tool call before cancel");
write({jsonrpc:"2.0",method:"session/cancel",params:{sessionId:session}});
const cancelled=await waitFor(m=>m.id===5,"cancelled result");
assert.equal(cancelled.result.stopReason,"cancelled");
assert.ok(calls.some(c=>c.url==="/v1/missions/m1/cancel"&&c.body.projectId==="my-shop"));

// Protocol errors.
write({jsonrpc:"2.0",id:6,method:"session/load",params:{}});
assert.equal((await waitFor(m=>m.id===6,"unknown method")).error.code,-32601);
child.stdin.write("{not json\n");
assert.equal((await waitFor(m=>m.error?.code===-32700,"parse error")).id,null);
write({jsonrpc:"2.0",id:7,method:"session/prompt",params:{sessionId:"nope",prompt:[]}});
assert.equal((await waitFor(m=>m.id===7,"unknown session")).error.code,-32602);
assert.ok(calls.every(c=>c.auth==="Bearer test-token"),"every call carries the token");

child.stdin.end();
await new Promise(r=>child.on("close",r));
layanx.close();fs.rmSync(dataDir,{recursive:true,force:true});
console.log("acp-agent: initialize, session/new links the folder, prompt -> mission with plan/tool calls, editor approvals, decline, cancel and protocol errors verified over stdio");
process.exit(0);
