import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const appPath=fileURLToPath(new URL("../web/app.js",import.meta.url));
const app=await readFile(appPath,"utf8");

// The API's canonical contract is { running, frameAvailable }, not { enabled }.
// The start/stop button and frame poller must consume the same running field.
assert.match(app,/const live=S\.live&&S\.live\.running/);
assert.match(app,/if\(!box\)return;/);
assert.match(app,/if\(!\(S\.live&&S\.live\.running\)\)/);
assert.doesNotMatch(app,/S\.live&&S\.live\.enabled/);
assert.match(app,/status\?\.lastError/);
assert.match(app,/Date\.now\(\)-Date\.parse\(status\.lastFrameAt\)>5000/);
assert.match(app,/t\("screenStale"\)/);

console.log("live-screen-ui-contract: dashboard consumes the backend running status field");
