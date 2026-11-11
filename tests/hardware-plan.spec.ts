import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {approvePulls,checkHardware,describePlan,detectHardware,hardwareTier,planForHardware,pullMode,pullPlanned,type HardwareProfile} from "../src/platform/hardware-plan.js";

const machine=(ramGB:number,vramGB:number,diskFreeGB=500,gpuName=vramGB?"GPU":""):HardwareProfile=>({os:"test",cpuModel:"cpu",cpuCores:12,ramGB,gpuName,vramGB,diskFreeGB,modelsDir:"x"});
const roles=(plan:ReturnType<typeof planForHardware>)=>Object.fromEntries(plan.models.map(m=>[m.role,m.name]));

// Detection reads the biggest card and the free disk, and survives a machine with no NVIDIA driver.
const seen=detectHardware({env:{},exec:()=>"GeForce GTX 1660 SUPER, 6144\nOther, 2048\n",statfs:()=>({bavail:200*2**18,bsize:4096})});
assert.equal(seen.gpuName,"GeForce GTX 1660 SUPER");assert.equal(seen.vramGB,6);assert.equal(seen.diskFreeGB,200);
assert.equal(detectHardware({env:{},exec:()=>{throw new Error("no driver");},statfs:()=>({bavail:0,bsize:0})}).vramGB,0);

assert.equal(hardwareTier({ramGB:8,vramGB:0}),"light");assert.equal(hardwareTier({ramGB:32,vramGB:6}),"standard");
assert.equal(hardwareTier({ramGB:64,vramGB:24}),"strong");assert.equal(hardwareTier({ramGB:128,vramGB:48}),"workstation");

// A light laptop gets a small builder, nothing it cannot hold, and is told plainly what that means.
const light=planForHardware(machine(8,0));
assert.equal(light.tier,"light");assert.equal(roles(light).builder,"qwen3.5:4b");
assert.ok(light.models.every(m=>m.sizeGB<=8*0.55));assert.ok(light.skipped.some(s=>s.name==="gpt-oss:20b"));
assert.equal(roles(light).reviewer,undefined);assert.match(light.advice.join(" "),/reviews its own work/);
assert.equal(light.settings.requestTimeoutSec,300);assert.equal(light.settings.parallelModels,1);

// The owner's machine today: the measured builder, split with memory, and no separate reviewer that would time out.
const today=planForHardware(machine(32,6),{"gpt-oss:20b":13,"qwen3.8:27b":17,"gemma4:12b":8,"qwen3.5:4b":3.3,"qwen3-embedding:0.6b":0.64});
assert.equal(roles(today).builder,"gpt-oss:20b");assert.equal(today.models.find(m=>m.role==="builder")!.placement,"mixed");
assert.equal(roles(today).reviewer,undefined,"a reviewer that spills into memory timed out on every review");
assert.equal(today.settings.requestTimeoutSec,180);assert.match(today.advice.join(" "),/video memory would make it several times faster/);
assert.equal(today.toPull.length,0,"everything it needs is already there");

// After the upgrade (64 GB, 24 GB card): an independent reviewer fits, a stronger model goes on trial, and two can run at once.
const upgraded=planForHardware(machine(64,24),{"gpt-oss:20b":13,"qwen3.5:4b":3.3,"qwen3-embedding:0.6b":0.64});
assert.equal(upgraded.tier,"strong");assert.equal(roles(upgraded).builder,"gpt-oss:20b","the measured builder stays until a trial beats it");
assert.equal(upgraded.models.find(m=>m.role==="builder")!.placement,"gpu");
assert.equal(roles(upgraded).reviewer,"qwen3.8:27b");assert.equal(roles(upgraded).trial,"qwen3.8:27b");
assert.equal(upgraded.settings.requestTimeoutSec,180);assert.equal(upgraded.settings.reviewers,2);
assert.ok(upgraded.toPull.includes("qwen3.8:27b"));assert.equal(upgraded.toPull.includes("gpt-oss:20b"),false);

// A full disk stops downloads before it fills, starting with the least important.
const tight=planForHardware(machine(64,24,30));
assert.ok(tight.pullGB<=30-15);assert.ok(tight.skipped.some(s=>/free disk/.test(s.why)));
assert.ok(tight.toPull.includes("qwen3-embedding:0.6b"));

// A workstation can keep two big models loaded together.
assert.equal(planForHardware(machine(128,48)).settings.parallelModels,2);
assert.match(describePlan(upgraded),/Class: strong/);

// Remembering the machine: a change is noticed, approvals are only for models in the plan, and pulling obeys the owner.
const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-hw-"));
const first=checkHardware(store,machine(32,6),{});
assert.equal(first.changed,true);assert.equal(checkHardware(store,machine(32,6),{}).changed,false);
assert.throws(()=>approvePulls(store,["some-other:70b"]),/not_in_plan/);
const after=checkHardware(store,machine(64,24),{});
assert.equal(after.changed,true);assert.equal(after.previous,first.state.fingerprint);
const wanted=after.state.plan.toPull[0]!;
const approved=approvePulls(store,[wanted]);
const calls:string[]=[];const pull=async(name:string)=>{calls.push(name);if(name==="qwen3.5:9b")throw new Error("network");};
const asked=await pullPlanned(approved,"ask",pull);
assert.deepEqual(asked.pulled,[wanted]);assert.deepEqual(calls,[wanted]);assert.ok(asked.waiting.length>0);
calls.length=0;assert.deepEqual((await pullPlanned(approved,"off",pull)).pulled,[]);assert.equal(calls.length,0);
const auto=await pullPlanned(approved,"auto",pull);assert.equal(auto.pulled.length+auto.failed.length,approved.plan.toPull.length);
assert.equal(pullMode({}),"ask");assert.equal(pullMode({LAYANX_MODEL_PULL:"AUTO"}),"auto");assert.equal(pullMode({LAYANX_MODEL_PULL:"yes please"}),"ask");
fs.rmSync(store,{recursive:true,force:true});
console.log("hardware plan: each machine gets what it can run, a changed machine is noticed, and downloads follow the owner");
process.exit(0);
