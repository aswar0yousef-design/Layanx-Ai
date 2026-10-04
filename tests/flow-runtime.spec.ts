import {FlowRuntime} from "../src/flows/runtime.js";

const calls:string[]=[];
const core={
 projectIsolation:{normalize:(id:string)=>id},
 memory:{recall:()=>[],remember:(x:unknown)=>x},
 runAgentGateway:async()=>({completed:true,missionId:"m1",results:[],final:{data:"ok"}})
} as any;

const runtime=new FlowRuntime(core,async(channel,chat,text)=>{calls.push(channel+":"+chat+":"+text);});
const flow={
 id:"f1",projectId:"p1",name:"support",status:"active" as const,version:1,
 createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
 nodes:[
  {id:"t",type:"trigger" as const,config:{eventType:"message"}},
  {id:"c",type:"condition" as const,config:{expression:"event.text contains buy"}},
  {id:"m",type:"message" as const,config:{text:"Sales: {{event.text}}"}},
  {id:"e",type:"end" as const,config:{}}
 ],
 edges:[
  {id:"a",source:"t",target:"c"},
  {id:"b",source:"c",target:"m",condition:"event.text contains buy"},
  {id:"c2",source:"m",target:"e"}
 ]
};
const result=await runtime.execute(flow,{id:"e1",projectId:"p1",channel:"webchat",senderId:"u",chatId:"chat",text:"I want to buy",timestamp:new Date().toISOString()});
if(result.status!=="completed")throw new Error("Flow did not complete: "+result.error);
if(calls[0]!=="webchat:chat:Sales: I want to buy")throw new Error("Message node did not deliver.");
let rejected=false;
try{runtime.validate({...flow,edges:[...flow.edges,{id:"cycle",source:"e",target:"t"}]});}catch{rejected=true;}
if(!rejected)throw new Error("Cycle validation failed.");
console.log("Flow runtime tests passed.");
