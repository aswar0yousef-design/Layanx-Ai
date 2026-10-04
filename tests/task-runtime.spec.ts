import {TaskRuntime} from "../src/core/task-runtime.js";

const events:string[]=[];
const fakeCore={projectIsolation:{normalize:(id:string)=>id},audit:{append:(entry:any)=>events.push(entry.action+":"+entry.resource)},memory:{remember:()=>{}},models:{get:(id:string)=>({id,capabilities:["reasoning"],local:true})},runAgentGateway:async(goal:string,_projectId:string,_maxSteps:number,_approvals:any,agentId:string,routing:any)=>{const id=goal.split("\n")[0];events.push("run:"+id+":"+agentId+":"+routing.modelId);await new Promise(resolve=>setTimeout(resolve,id==="a"?25:5));return{missionId:"m-"+id,completed:true,status:"completed",steps:1,results:[],data:id};}} as any;

const runtime=new TaskRuntime(fakeCore);
const result=await runtime.run({goal:"dependency graph",tasks:[
{id:"a",description:"a",capability:"coding",permission:"L3_MODIFY",dependencies:[],successCriteria:["a"]},
{id:"b",description:"b",capability:"coding",permission:"L3_MODIFY",dependencies:[],successCriteria:["b"]},
{id:"c",description:"c",capability:"coding",permission:"L3_MODIFY",dependencies:["a","b"],successCriteria:["c"]}
]},[
{taskId:"a",agentId:"dev",role:"developer",modelId:"m1",capability:"coding",reason:[]},
{taskId:"b",agentId:"dev2",role:"developer",modelId:"m2",capability:"coding",reason:[]},
{taskId:"c",agentId:"dev",role:"developer",modelId:"m3",capability:"coding",reason:[]}
], "default",2);
if(!result.completed)throw new Error("Expected task graph to complete.");
const aStart=events.indexOf("run:a:dev:m1"),bStart=events.indexOf("run:b:dev2:m2"),cStart=events.indexOf("run:c:dev:m3");
if(aStart<0||bStart<0||cStart<0||cStart<aStart||cStart<bStart)throw new Error("Dependency ordering failed.");

const failCore={...fakeCore,runAgentGateway:async(goal:string)=>({missionId:"fail",completed:goal.startsWith("a")?false:true,status:"failed",steps:1,results:[],reason:"boom"})} as any;
const blocked=await new TaskRuntime(failCore).run({goal:"failure graph",tasks:[
{id:"a",description:"a",capability:"coding",permission:"L3_MODIFY",dependencies:[],successCriteria:["a"]},
{id:"b",description:"b",capability:"coding",permission:"L3_MODIFY",dependencies:["a"],successCriteria:["b"]}
]},[
{taskId:"a",agentId:"dev",role:"developer",modelId:"m1",capability:"coding",reason:[]},
{taskId:"b",agentId:"dev",role:"developer",modelId:"m1",capability:"coding",reason:[]}
]);
if(blocked.records.find(r=>r.taskId==="b")?.status!=="blocked")throw new Error("Failed dependency should block downstream task.");
console.log("Dependency-aware task runtime tests passed.");