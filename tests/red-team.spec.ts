import {RedTeamHarness} from "../src/security/red-team.js";
import {ProjectIsolation} from "../src/security/project-isolation.js";
import {CapabilityTokenService} from "../src/security/capability-token.js";
import {ApprovalEngine} from "../src/security/approval.js";
import {MemoryFirewall} from "../src/memory/memory-firewall.js";
import {Sentinel} from "../src/security/sentinel.js";
const isolation=new ProjectIsolation();
const capability=new CapabilityTokenService();
const approvals=new ApprovalEngine();
const firewall=new MemoryFirewall();
const sentinel=new Sentinel();
const harness=new RedTeamHarness();
const report=await harness.run([
 {name:"cross-project isolation",run:async()=>{try{isolation.assertSameProject("a",{projectId:"b",resourceId:"x"});return{passed:false,detail:"bypass"};}catch{return{passed:true,detail:"blocked"};}}},
 {name:"capability scope",run:async()=>{const t=capability.issue({missionId:"m1",agentId:"a1",projectId:"p1",resource:"repo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});const r=capability.validate(t,{missionId:"m2",agentId:"a1",projectId:"p1",resource:"repo",permission:"L1_READ"});return{passed:!r.allowed,detail:r.reason};}},
 {name:"approval scope",run:async()=>{const a=approvals.create({missionId:"m1",agentId:"a1",action:"deploy",permission:"L4_EXECUTE",reason:"test",expiresAt:new Date(Date.now()+60000).toISOString()});approvals.approve(a.id);const r=approvals.authorize(a.id,{missionId:"m2",agentId:"a1",action:"deploy",permission:"L4_EXECUTE"});return{passed:!r.allowed,detail:r.reason};}},
 {name:"memory secret rejection",run:async()=>{try{firewall.sanitize({id:"s",kind:"semantic",content:"pass"+"word=secret",tags:[],createdAt:new Date().toISOString()});return{passed:false,detail:"secret stored"};}catch{return{passed:true,detail:"blocked"};}}},
 {name:"sentinel block",run:async()=>{const r=sentinel.inspect("disable_security");return{passed:!r.allowed,detail:r.reason};}}
]);
if(report.failed!==0)throw new Error("Red-team checks failed: "+JSON.stringify(report));
console.log("Red-team security suite passed.");
