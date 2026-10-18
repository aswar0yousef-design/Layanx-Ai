import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const appPath=fileURLToPath(new URL("../web/app.js",import.meta.url));
const app=await readFile(appPath,"utf8");

// The Control Center must support local MCP executables, not only Registry results.
// Keep the invocation structured: an absolute executable plus separate argv entries, no shell.
assert.match(app,/mcpCustom:"Add local MCP server"|mcpCustom:"إضافة خادم محلي"/);
assert.match(app,/const customForm=el\("div",\{class:"card",hidden:true/);
assert.match(app,/body:\{id,name:name\|\|id,transport:"stdio",command,args,note:/);
assert.match(app,/\/v1\/mcp\/servers/);
assert.match(app,/split\(\/\\r\?\\n\/\)/);
assert.match(app,/mcpCommandHelp:/);

console.log("mcp-panel: owner can add local MCP executables with argv entries, disabled until explicit approval");
