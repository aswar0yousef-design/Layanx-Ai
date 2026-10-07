import assert from "node:assert/strict";
import {LayanXCore} from "../src/core/orchestrator.js";
import {autoApproved} from "../src/core/runtime.js";
import type {ToolRequest} from "../src/core/types.js";

// A dangerous tool (send, push, click, publish, trade...) must stop for the owner's approval even at medium risk.
delete process.env.LAYANX_AUTO_APPROVE_TOOLS;delete process.env.LAYANX_QURAN_AUTOSCHEDULE;
const core=new LayanXCore();
core.registerAgent({agentId:"runner",purpose:"send mail",allowedTools:["mail.send"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"mail.send",description:"Send an email",permission:"L4_EXECUTE",dangerous:true});
const mission=core.startMission("Send the weekly email","p1");
const run=async(approvalId?:string)=>{
  const capability=core.capabilities.issue({missionId:mission.id,agentId:"runner",projectId:"p1",resource:"mail.send",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
  const request:ToolRequest={missionId:mission.id,agentId:"runner",tool:"mail.send",action:"send email",permission:"L4_EXECUTE",idempotencyKey:"mail-"+(approvalId??"none"),payload:{to:"owner@example.com"}};
  return new (await import("../src/core/mission-runner.js")).MissionRunner(core).execute(mission,request,{async execute(){sent++;return{done:true};}},approvalId,{projectId:"p1",capabilityId:capability.id}) as Promise<any>;
};
let sent=0;
const first=await run();
assert.equal(first.ok,false,"blocked without approval");
assert.match(String(first.error),/approval/i);
assert.equal(sent,0,"nothing was sent without approval");

process.env.LAYANX_AUTO_APPROVE_TOOLS="mail.send";
const second=await run();
assert.equal(second.ok,true,"runs once the owner pre-approves the tool");
assert.equal(sent,1);
delete process.env.LAYANX_AUTO_APPROVE_TOOLS;

assert.equal(autoApproved("quran.publish_next",{LAYANX_QURAN_AUTOSCHEDULE:"true"}),true,"scheduled Quran publishing stays unattended");
assert.equal(autoApproved("mail.send",{}),false);
console.log("dangerous-tool-approval: dangerous tools wait for approval unless pre-approved");
