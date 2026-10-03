import {runReadinessGate} from "../src/readiness.js";
import {createRuntime} from "../src/runtime.js";

const runtime=createRuntime();
const result=await runReadinessGate(runtime);
if(!result.reviewedTwice)throw new Error("Readiness gate did not perform two structural review passes.");
if(!result.checks.some(check=>check.id==="double-review-consistency"&&check.ok))throw new Error("Double-review consistency check failed.");
if(!result.checks.some(check=>check.id==="security-controls"&&check.ok))throw new Error("Security controls are not initialized.");
if(!result.checks.some(check=>check.id==="critical-tools"&&check.ok))throw new Error("Critical tools are missing.");
console.log("Final readiness gate test passed.");
