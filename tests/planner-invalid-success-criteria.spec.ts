import assert from "node:assert/strict";
import {AiMissionPlanner} from "../src/core/ai-planner.js";
import type {ToolCatalogEntry} from "../src/core/tool-catalog.js";

const catalog:ToolCatalogEntry[]=[{name:"files.write",description:"Write file",
 permission:"L3_MODIFY",dangerous:false,actions:["write file"],tags:["write"]}];
const original={risk:"low",requiredPermission:"L3_MODIFY",
 steps:[{description:"Write Node.js module"}],
 successCriteria:["result.createServer exports createServer function","result.server.listen is called"],
 stopCondition:"Stop if file write fails",
 tools:[{tool:"files.write",action:"write file",permission:"L3_MODIFY",reason:"create file",
 payload:{path:"src/server.mjs",content:"export const createServer = () => {};\n"}}]};
let calls=0;
const planner=new AiMissionPlanner({async execute(){
 calls++;
 return{output:JSON.stringify(calls===1?original:{...original,successCriteria:["File write completes successfully"]})};
}} as never);
const planned=await planner.plan("Create src/server.mjs",catalog);
assert.equal(calls,2,"Invalid result property prose must be rejected and repaired once");
assert.deepEqual(planned.successCriteria,["File write completes successfully"]);

const normalized=new AiMissionPlanner({async execute(){return{output:JSON.stringify({
 ...original,successCriteria:["result.fileExists package.json"]})}}} as never);
assert.deepEqual((await normalized.plan("Create package.json",catalog)).successCriteria,
 ["result.written === true"],"File existence pseudo-criteria must use actual final file-write receipt");

const inventedServerFields=new AiMissionPlanner({async execute(){return{output:JSON.stringify({
 ...original,successCriteria:[
  "result.server.respondsToGEThealthwithJSONoktrue",
  "result.server.respondsToPOSTtaskswithJSONidtitle",
  "result.server.respondsToGETtaskswithJSONtasks",
  "result.server.respondsToDeleteTaskstasksid"
 ]})}}} as never);
assert.deepEqual((await inventedServerFields.plan("Create src/server.mjs",catalog)).successCriteria,
 ["result.written === true"],
 "Nonexistent nested server properties must not mask a successful actual file write");

const noWrite=new AiMissionPlanner({async execute(){return{output:JSON.stringify({
 ...original,successCriteria:["result.fileExists package.json"],tools:[]})}}} as never);
await assert.rejects(()=>noWrite.plan("Check a file without writing",catalog),
 /Unsupported planner success criterion/,"No write receipt: cannot normalize unsupported result claims");

const stubborn=new AiMissionPlanner({async execute(){return{output:JSON.stringify(original)}}} as never);
await assert.rejects(()=>stubborn.plan("Create module",catalog),
 /Unsupported planner success criterion/,"Unrepaired invalid criteria cannot run");

const valid=new AiMissionPlanner({async execute(){return{output:JSON.stringify({
 ...original,successCriteria:["result.written === true"]})}}} as never);
assert.deepEqual((await valid.plan("Write file",catalog)).successCriteria,["result.written === true"]);
console.log("Planner rejects unsupported pseudo-result assertions before mission execution");
