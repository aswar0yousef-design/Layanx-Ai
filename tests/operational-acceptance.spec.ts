import {runOperationalAcceptance} from "../src/operational-acceptance.js";

const requiredTools=[
  "runtime.status","mission.inspect","memory.recall","project.inspect",
  "terminal.exec","files.read","files.list","browser.read","desktop.status","desktop.screenshot"
];

const fakeProvider={
  name:"acceptance-provider",
  health:async()=>({provider:"acceptance-provider",available:true,updatedAt:new Date().toISOString()})
};

const runtime={
  core:{
    isReady:()=>true,
    tools:{list:()=>requiredTools.map(name=>({name,description:"acceptance",permission:"L1_READ",dangerous:false}))},
    permissions:{},sentinel:{},risk:{},audit:{}
  },
  models:{list:()=>[{id:"acceptance-model",provider:"acceptance-provider"}]},
  providers:{list:()=>[fakeProvider]},
  providerSummary:{mode:"local"},
  liveScreen:undefined,
  persistence:undefined
} as never;

const result=await runOperationalAcceptance(runtime,{requireLiveProviders:false});

if(!result.reviewedTwice)throw new Error("Operational acceptance did not perform the readiness double review.");
if(!result.accepted)throw new Error("Operational acceptance rejected a structurally valid runtime.");
if(!result.checks.some(check=>check.id==="unique-tool-identities"&&check.ok))throw new Error("Tool uniqueness gate failed.");
if(!result.checks.some(check=>check.id==="acceptance-no-duplicate-registration"&&check.ok))throw new Error("Duplicate registration gate failed.");
if(!result.checks.some(check=>check.id==="live-provider-gate"&&!check.blocking))throw new Error("Non-strict provider gate should remain informational.");
console.log("Operational acceptance contract test passed.");
