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

test("the same audit event gets the same id from the full log and from a per-mission list",()=>{
 const a={timestamp:"2026-10-02T10:00:00.000Z",actor:"core",action:"tool.run",resource:"git",result:"success" as const,metadata:{missionId:"m1"}};
 const b={timestamp:"2026-10-02T10:00:01.000Z",actor:"core",action:"tool.run",resource:"files",result:"success" as const,metadata:{missionId:"m2"}};
 const full=new MissionEventStream();full.sync([a,b],{m1:"p1",m2:"p1"});
 const single=new MissionEventStream();single.sync([b],{m2:"p1"});
 assert.equal(full.list("p1","m2")[0]?.id,single.list("p1","m2")[0]?.id);
 full.sync([b],{m2:"p1"});
 assert.equal(full.list("p1","m2").length,1,"syncing a shorter list does not duplicate events");
});

test("after works across missions: an older mission's later event is not skipped",()=>{
 const ev=(m:string,t:string,r:string)=>({timestamp:t,actor:"core",action:"tool.run",resource:r,result:"success" as const,metadata:{missionId:m}});
 const stream=new MissionEventStream();
 stream.sync([ev("m1","2026-10-02T10:00:00.000Z","a"),ev("m2","2026-10-02T10:00:01.000Z","b")],{m1:"p1",m2:"p1"});
 const seen=stream.list("p1").at(-1)!.id;
 stream.sync([ev("m1","2026-10-02T10:00:02.000Z","c")],{m1:"p1"});
 assert.deepEqual(stream.list("p1",undefined,seen).map(e=>e.tool),["c"]);
 // An evicted id still works as a cursor.
 const many=new MissionEventStream();
 many.sync(Array.from({length:205},(_,i)=>ev("m1",new Date(Date.UTC(2026,9,2,10,0,i)).toISOString(),"t"+i)),{m1:"p1"});
 const firstId=new MissionEventStream();firstId.sync([ev("m1",new Date(Date.UTC(2026,9,2,10,0,0)).toISOString(),"t0")],{m1:"p1"});
 assert.equal(many.list("p1","m1",firstId.list("p1","m1")[0]!.id).length,200,"evicted cursor: only the retained newer events");
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
