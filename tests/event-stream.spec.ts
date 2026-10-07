import assert from "node:assert/strict";
import test from "node:test";
import {MissionEventStream} from "../src/core/event-stream.js";

test("mission events are project scoped and stable",()=>{
 const stream=new MissionEventStream();
 stream.sync([
  {timestamp:"2026-10-02T10:00:00.000Z",actor:"core",action:"tool.run",resource:"git",result:"success",metadata:{missionId:"m1"}},
  {timestamp:"2026-10-02T10:00:01.000Z",actor:"core",action:"approval.required",resource:"git",result:"denied",metadata:{missionId:"m2",projectId:"p2",reason:"approval required"}}
 ],{m1:"p1",m2:"p2"});
 const p1=stream.list("p1");
 const p2=stream.list("p2");
 assert.equal(p1.length,1);
 assert.equal(p1[0]?.missionId,"m1");
 assert.equal(p2.length,1);
 assert.equal(p2[0]?.type,"approval.required");
 assert.equal(stream.list("p1","m1",p1[0]?.id).length,0);
});

test("after = the last seen event id returns exactly the later events (ids are hashes, not ordered)",()=>{
 const stream=new MissionEventStream();
 const audit=Array.from({length:30},(_,i)=>({timestamp:new Date(2026,9,2,10,0,i).toISOString(),actor:"core",action:"tool.run",resource:"tool"+i,result:"success" as const,metadata:{missionId:"m1"}}));
 stream.sync(audit,{m1:"p1"});
 const all=stream.list("p1","m1");
 for(const k of [0,7,15,28]){
  const later=stream.list("p1","m1",all[k]!.id);
  assert.deepEqual(later.map(e=>e.id),all.slice(k+1).map(e=>e.id));
 }
 assert.equal(stream.list("p1","m1",all.at(-1)!.id).length,0);
});

test("event retention is bounded per mission",()=>{
 const stream=new MissionEventStream();
 const audit=Array.from({length:250},(_,i)=>({
  timestamp:new Date(2026,9,2,10,0,i).toISOString(),actor:"core",action:"tool.run",
  resource:"tool",result:"success" as const,metadata:{missionId:"m1"}
 }));
 stream.sync(audit,{m1:"p1"});
 assert.equal(stream.list("p1","m1").length,200);
});
