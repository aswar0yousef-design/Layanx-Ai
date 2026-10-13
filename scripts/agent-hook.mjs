#!/usr/bin/env node
/**
 * PermissionRequest hook for Claude Code and Codex (installed by `layanx hooks install`).
 *
 * When Claude Code or Codex wants to run something that needs your permission, this asks
 * LayanX on this PC instead: the request reaches your phone (approve or reject with your
 * fingerprint), the desktop island and the control center. The answer goes back as the
 * hook's decision.
 *
 * Fail-safe: if LayanX is not running, or nobody answers in time, the hook prints nothing
 * and Claude Code / Codex shows its own question in the terminal as usual.
 *
 *   node agent-hook.mjs claude|codex <agent-hooks.json> [wait seconds]
 * Plain Node, no packages: it runs inside the agent's own process environment.
 */
import fs from "node:fs";
import http from "node:http";

const agent=process.argv[2]==="codex"?"codex":"claude-code";
const configFile=process.argv[3]??"";
const waitSeconds=Math.min(Math.max(Number(process.argv[4])||120,10),540);
const deadline=Date.now()+waitSeconds*1000;

function readStdin(){
  return new Promise(resolve=>{
    let text="";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data",c=>{text+=c;if(text.length>1_000_000)process.stdin.destroy();});
    process.stdin.on("end",()=>resolve(text));
    process.stdin.on("error",()=>resolve(text));
  });
}

function call(port,token,method,path,body,timeoutMs){
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const req=http.request({host:"127.0.0.1",port,method,path,timeout:timeoutMs,headers:{authorization:"Bearer "+token,accept:"application/json",...(payload?{"content-type":"application/json","content-length":Buffer.byteLength(payload)}:{})}},res=>{
      let text="";res.setEncoding("utf8");res.on("data",c=>{text+=c;});
      res.on("end",()=>{let json={};try{json=JSON.parse(text||"{}");}catch{}resolve({status:res.statusCode??0,json});});
    });
    req.on("timeout",()=>req.destroy(new Error("timeout")));
    req.on("error",reject);
    if(payload)req.write(payload);
    req.end();
  });
}

function decide(behavior,message){
  const decision=behavior==="allow"?{behavior:"allow"}:{behavior:"deny",message};
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PermissionRequest",decision}}));
}

async function main(){
  let input;
  try{input=JSON.parse(await readStdin());}catch{return;}
  if(!input||input.hook_event_name!=="PermissionRequest")return;
  let config;
  try{config=JSON.parse(fs.readFileSync(configFile,"utf8"));}catch{return;}
  const port=Number(config.port),token=String(config.token??"");
  if(!port||!token.startsWith("lxh_"))return;
  let id;
  try{
    const created=await call(port,token,"POST","/v1/external/approvals",{agent,sessionId:input.session_id,cwd:input.cwd,tool:input.tool_name,toolInput:input.tool_input,waitSeconds},5000);
    if(created.status!==201||!created.json.id)return;
    id=created.json.id;
  }catch{return;} // LayanX is not running: the terminal asks as usual
  let status="pending";
  while(status==="pending"&&Date.now()<deadline){
    try{
      const left=Math.max(1,Math.min(25,Math.floor((deadline-Date.now())/1000)));
      const r=await call(port,token,"GET",`/v1/external/approvals/${encodeURIComponent(id)}?wait=${left}`,undefined,(left+10)*1000);
      if(r.status===404)return;
      status=r.json.status??"pending";
    }catch{await new Promise(r=>setTimeout(r,2000));}
  }
  if(status==="approved"){decide("allow");return;}
  if(status==="rejected"){decide("deny","Rejected by the owner in LayanX.");return;}
  // No answer in time: take the request back from the phone, and let the terminal ask.
  try{await call(port,token,"DELETE",`/v1/external/approvals/${encodeURIComponent(id)}`,undefined,3000);}catch{}
}

main().then(()=>process.exit(0),()=>process.exit(0));
