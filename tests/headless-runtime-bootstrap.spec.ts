import assert from "node:assert/strict";

// The live Ollama acceptance runner deliberately enables only coding.
// Previously createRuntime() crashed because it still resolved desktop.screenshot.
process.env.LAYANX_CAPABILITIES="coding";
process.env.LAYANX_AI_MODE="local";
process.env.OPENAI_ENABLED="false";
process.env.ANTHROPIC_ENABLED="false";
process.env.GEMINI_ENABLED="false";

const {createRuntime}=await import("../src/runtime.js");
const runtime=createRuntime();
assert.ok(runtime.core.isReady(),"Coding-only runtime starts without a desktop adapter");
assert.equal(runtime.core.toolAdapters.has("desktop.screenshot"),false);
assert.equal(runtime.liveScreen,undefined,"No screen observer without desktop capability");
assert.equal(runtime.core.liveScreenStatus().running,false);
assert.equal(runtime.core.liveScreenStatus().frameAvailable,false);
assert.throws(()=>runtime.core.startLiveScreen(),/not configured/);
assert.ok(runtime.core.toolAdapters.has("project.run"),"Coding functionality remains available");

console.log("headless runtime: coding-only startup works without screenshot adapter");
