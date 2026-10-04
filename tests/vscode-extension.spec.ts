import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(process.cwd(),"vscode-extension");
const manifestPath=resolve(root,"package.json");
const extensionPath=resolve(root,"extension.js");
assert.equal(existsSync(manifestPath),true,"VS Code extension manifest must exist");
assert.equal(existsSync(extensionPath),true,"VS Code extension entrypoint must exist");

const manifest=JSON.parse(readFileSync(manifestPath,"utf8")) as {
  main:string;
  engines:{vscode:string};
  contributes:{commands:Array<{command:string}>;configuration:{properties:Record<string,unknown>};viewsContainers:unknown};
};
assert.equal(manifest.main,"./extension.js");
assert.ok(manifest.engines.vscode);
const commands=manifest.contributes.commands.map(item=>item.command);
for(const command of ["layanx.openAgent","layanx.runGoal","layanx.buildProject","layanx.explainSelection","layanx.fixSelection","layanx.health","layanx.startRuntime","layanx.setApiToken"]){
  assert.ok(commands.includes(command),`Missing VS Code command: ${command}`);
}
assert.ok(manifest.contributes.configuration.properties["layanx.apiBaseUrl"]);
assert.ok(manifest.contributes.configuration.properties["layanx.projectId"]);
assert.ok(manifest.contributes.configuration.properties["layanx.maxSteps"]);

execFileSync(process.execPath,["--check",extensionPath],{stdio:"pipe"});
const source=readFileSync(extensionPath,"utf8");
assert.match(source,/\/v1\/agent\/gateway/);
assert.match(source,/context\.secrets\.store/);
assert.doesNotMatch(source,/apiToken["']\s*:/);

console.log("VS Code extension manifest and entrypoint checks passed.");

assert.match(source,/\/v1\/missions/);
assert.match(source,/\/agent-loop/);
assert.match(source,/\/events\?projectId=/);
assert.match(source,/approvalIds/);
assert.match(source,/Approve and Continue/);
assert.match(source,/nextToolIndex/);
console.log("VS Code live mission workflow checks passed.");

assert.match(source,/Build \/ Repair Project/);
assert.match(source,//v1\/missions\//);
assert.match(source,/\/cancel/);
assert.match(source,/\/repair/);
assert.match(source,/function executeMissionLoop/);
assert.match(source,/function repairMission/);
assert.match(source,/function cancelMission/);
assert.match(source,/preserve unrelated work/);
console.log("VS Code builder, repair, cancellation and resumable execution checks passed.");
