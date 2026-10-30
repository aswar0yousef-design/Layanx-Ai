import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Dashboard progress is milestone progress; verification and handoff are separately visible.
// This guards against the earlier "100% done" UI being mistaken for proven delivery.
const file=path.resolve("web","app.js");
const source=fs.readFileSync(file,"utf8");
new vm.Script(source,{filename:file});
assert.match(source,/j\.outcome/,"Evidence should be sourced from the stored Outcome report");
assert.match(source,/outcome\.blockers/,"Independent verification blockers must be visible");
assert.match(source,/j\.behavior/,"Behavioral acceptance must be visible as a separate gate");
assert.match(source,/j\.delivery/,"Delivery manifest paths must be visible");
assert.match(source,/Milestones /,"A milestone percentage must not be mislabeled final verification");
assert.match(source,/تقدم الخطوات/,"Arabic label must distinguish step progress from actual verification");
console.log("supervisor dashboard evidence: parsed and exposes gates, blockers and handoff");
