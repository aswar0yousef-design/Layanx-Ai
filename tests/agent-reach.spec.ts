import {createAgentReachAdapter} from "../src/connectors/agent-reach.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import {registerAgentReachTools} from "../src/agent-reach-tools.js";

type Call={command:string;args:string[]};
const calls:Call[]=[];
const adapter=createAgentReachAdapter({
 command:"agent-reach-test",
 runner:async(command,args)=>{
  calls.push({command,args});
  if(args[0]==="doctor")return{stdout:JSON.stringify({channels:{web:{status:"ok"}}}),stderr:"",code:0};
  if(args[0]==="channels")return{stdout:JSON.stringify(["web","github","youtube"]),stderr:"",code:0};
  if(args[0]==="check-update")return{stdout:JSON.stringify({updateAvailable:false}),stderr:"",code:0};
  if(args[0]==="collect")return{stdout:JSON.stringify({items:[{title:"test",url:"https://example.com"}]}),stderr:"",code:0};
  if(args[0]==="install")return{stdout:"safe install check complete",stderr:"",code:0};
  return{stdout:"",stderr:"unexpected",code:1};
 }
});

const request=(action:string,payload:Record<string,unknown>={})=>({id:"test",missionId:"m",projectId:"p",action,payload,permission:"L1_READ"} as any);

const status=await adapter.execute(request("agent reach status"));
if(!(status as any).installed)throw new Error("Agent Reach status did not report installed.");

const collected=await adapter.execute(request("agent reach collect",{channel:"github",operation:"search",input:"LayanX AI",limit:3}));
if(!Array.isArray((collected as any).items))throw new Error("Agent Reach collection was not parsed.");

const safe=await adapter.execute(request("agent reach setup",{system:false,dryRun:true}));
if((safe as any).system!==false||!calls.some(call=>call.args.includes("--safe")))throw new Error("Safe Agent Reach setup was not enforced.");

let rejected=false;
try{await adapter.execute(request("agent reach collect",{channel:"unknown",operation:"search",input:"x"}));}catch{rejected=true;}
if(!rejected)throw new Error("Unsupported Agent Reach channel was not rejected.");

const core=new LayanXCore();
registerAgentReachTools(core);
for(const name of ["agent-reach.status","agent-reach.channels","agent-reach.update.check","agent-reach.collect","agent-reach.setup","agent-reach.capabilities"]){
 if(!core.tools.get(name))throw new Error("Missing Agent Reach tool: "+name);
}
if(core.tools.get("agent-reach.collect").permission!=="L2_ANALYZE")throw new Error("Collection must be analysis-level.");
if(core.tools.get("agent-reach.setup").permission!=="L4_EXECUTE"||!core.tools.get("agent-reach.setup").dangerous)
 throw new Error("Setup must remain an explicit execute-level action.");

console.log("Agent Reach integration tests passed.");
