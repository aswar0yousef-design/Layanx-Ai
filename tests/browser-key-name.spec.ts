import assert from "node:assert/strict";
import {keyName} from "../src/autonomy/browser-test.js";
// Generated browser checks write "escape"; Playwright rejects it ("Unknown key"), which failed a correct page.
assert.equal(keyName("escape"),"Escape");
assert.equal(keyName("esc"),"Escape");
assert.equal(keyName("arrowdown"),"ArrowDown");
assert.equal(keyName("ctrl+a"),"Control+a");
assert.equal(keyName("f5"),"F5");
assert.equal(keyName("Enter"),"Enter");
assert.equal(keyName("a"),"a");
console.log("browser key name tests passed");
