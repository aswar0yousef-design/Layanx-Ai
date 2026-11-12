import assert from "node:assert/strict";
import fs from "node:fs";
import {localOnlyWork} from "../src/autonomy/supervisor.js";

// After a restart, work that only writes project files and runs local checks is retried; anything else still waits for the
// owner (seen live 2026-11-12: every LayanX restart left a project "failed: review required").
for(const profile of ["static-site-v1","node-tool-v1","http-api-v1","python-tool-v1","node-repair-v1","static-repair-v1","task-app-http-v1"])assert.ok(localOnlyWork({acceptanceProfile:profile as never}),profile);
assert.equal(localOnlyWork({}),false,"a general job may have sent messages or clicked things: the owner decides");
const src=fs.readFileSync(new URL("../src/autonomy/supervisor.ts",import.meta.url),"utf8");
assert.match(src,/unknownEffects&&!orphanApproval&&localOnlyWork\(job\)/);
console.log("restart-resume-local: local build and repair work resumes after a restart; other work still waits for the owner");
