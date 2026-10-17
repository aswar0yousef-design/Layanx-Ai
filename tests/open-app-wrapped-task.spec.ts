import assert from "node:assert/strict";
import {LayanXCore} from "../src/core/orchestrator.js";

// Supervisor agent prompts wrap the actionable step in a multiline overall goal and acceptance context.
// The app-open planner must still recognise the concrete current milestone without consulting a model.
const core=new LayanXCore();
core.registerAgent({
  agentId:"core",purpose:"Desktop operator",allowedTools:["desktop.app.open","desktop.window.focus"],forbiddenResources:[],
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

core.tools.register({
  name:"desktop.window.focus",
  description:"Focus a named open desktop window",
  permission:"L4_EXECUTE",
  dangerous:true,
  actions:["desktop focus window"],
  tags:["desktop","window","focus"]
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

const verifyGoal=[
  "Overall goal: open Notepad and confirm it opened.",
  "Acceptance criteria: Notepad is open and its window is visible.",
  "Current milestone (2/2): تحقق من أن نافذة Notepad ظاهرة على سطح مكتب Windows",
  "Rules: use only the approved desktop tools."
].join("\\n");
const verifyMission=await core.planMission(verifyGoal);
assert.equal(verifyMission.tools?.length,1);
assert.equal(verifyMission.tools?.[0]?.tool,"desktop.window.focus");
assert.equal(verifyMission.tools?.[0]?.action,"desktop focus window");
assert.deepEqual(verifyMission.tools?.[0]?.payload,{title:"Notepad"});
assert.deepEqual(verifyMission.successCriteria,["result.focused === true",'result.title contains "Notepad"']);

console.log("open-app-wrapped-task: opening and verifying Notepad both use deterministic desktop plans");
