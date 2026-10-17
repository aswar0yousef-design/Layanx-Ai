import assert from "node:assert/strict";
import {LayanXCore} from "../src/core/orchestrator.js";

// Supervisor agent prompts wrap the actionable step in a multiline overall goal and acceptance context.
// The app-open planner must still recognise the concrete current milestone without consulting a model.
const core=new LayanXCore();
core.registerAgent({
  agentId:"core",purpose:"Desktop operator",allowedTools:["desktop.app.open"],forbiddenResources:[],
  requiredPermission:"L4_EXECUTE",maxToolCalls:5,maxRuntimeMs:10000,
  successCriteria:["requested application is open"],stopCondition:"Stop if launch fails."
});
core.tools.register({
  name:"desktop.app.open",
  description:"Open a known desktop application",
  permission:"L4_EXECUTE",
  dangerous:true,
  actions:["desktop open app"],
  tags:["desktop","open","application"]
});

const wrappedGoal=[
  "Overall goal: open Notepad and confirm it opened.",
  "Acceptance criteria: Notepad is open and its window is visible.",
  "Current milestone (1/2): افتح Notepad",
  "Rules: use only the approved desktop tools."
].join("\n");
const mission=await core.planMission(wrappedGoal);
assert.equal(mission.tools?.length,1);
assert.equal(mission.tools?.[0]?.tool,"desktop.app.open");
assert.equal(mission.tools?.[0]?.action,"desktop open app");
assert.deepEqual(mission.tools?.[0]?.payload,{app:"Notepad"});

console.log("open-app-wrapped-task: recognizes a direct app-opening step inside a supervisor prompt");
