import assert from "node:assert/strict";
import fs from "node:fs";
import {routeRequest} from "../src/voice/request-router.js";
import {OWNER_REQUESTS,HELD_OUT_REQUESTS} from "./fixtures/owner-requests.js";

// One router for the Control Center and voice. Measured 2026-11-12: the old Control Center router 20/43 and 10/20 (it sent
// whole projects to the ten-step agent and never answered "where is the project?"), voice 34/43.
const score=(set:Array<[string,string]>)=>set.filter(([text,want])=>routeRequest(text).route===want);
const tuned=score(OWNER_REQUESTS),held=score(HELD_OUT_REQUESTS);
assert.ok(tuned.length>=43,`tuned set ${tuned.length}/${OWNER_REQUESTS.length}: `+OWNER_REQUESTS.filter(r=>!tuned.includes(r)).map(r=>r[0]).join(" | "));
// Written after tuning and never tuned on. 19/20 when first measured; a change must not make it worse.
assert.ok(held.length>=19,`held-out set ${held.length}/${HELD_OUT_REQUESTS.length}`);

// The ones that matter most: a question never starts work, and a fault plus "fix it" is repair.
assert.equal(routeRequest("هل يمكنك بناء موقع؟").route,"answer");
assert.equal(routeRequest("هل تقدر تصلح الأخطاء؟").route,"answer");
assert.equal(routeRequest("التطبيق يعلق عند فتح الإعدادات، شوف السبب واصلحه").route,"project-repair");
assert.equal(routeRequest("أبغى موقع لمطعمي فيه المنيو والأسعار").work,"build");

// The panel sends project work to the supervisor through the assistant, and the classify API says the route.
const app=fs.readFileSync(new URL("../web/app.js",import.meta.url),"utf8"),api=fs.readFileSync(new URL("../src/api-server.ts",import.meta.url),"utf8");
assert.match(app,/route==="project"/);
assert.match(app,/project-\(\?:build\|repair\|status\)/);
assert.match(api,/route:routed\.route/);
console.log(`request-router: ${tuned.length}/${OWNER_REQUESTS.length} tuned, ${held.length}/${HELD_OUT_REQUESTS.length} held out; questions never start work`);
