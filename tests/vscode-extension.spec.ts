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
for(const command of ["layanx.openAgent","layanx.runGoal","layanx.explainSelection","layanx.fixSelection","layanx.health","layanx.startRuntime","layanx.setApiToken"]){
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


it("supports live mission execution, event polling, and approval resume",()=>{
  const source=readFileSync(join(extensionDir,"extension.js"),"utf8");
  expect(source).toContain("/v1/missions");
  expect(source).toContain("/agent-loop");
  expect(source).toContain("/events?projectId=");
  expect(source).toContain("approvalIds");
  expect(source).toContain("Approve and Continue");
  expect(source).toContain("nextToolIndex");
});
