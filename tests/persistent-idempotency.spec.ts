import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {JsonStateStore} from "../src/core/persistence.js";
import {PersistentIdempotencyStore} from "../src/core/persistent-idempotency.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-persistent-idem-"));
const store=new PersistentIdempotencyStore(
  new JsonStateStore(join(dir,"idempotency.json"))
);
const request={
  missionId:"m1",agentId:"a1",tool:"echo",action:"echo",
  permission:"L1_READ" as const,idempotencyKey:"atomic-key",payload:"ok"
};

const [a,b]=await Promise.all([store.begin(request),store.begin(request)]);
const accepted=[a,b].filter(x=>x.accepted);
if(accepted.length!==1)throw new Error("Concurrent persistent claims were both accepted.");
await store.complete(request.idempotencyKey,"done");
const other={...request,missionId:"m2",idempotencyKey:"other-key"};
await store.begin(other);
await store.restore([{
  key:request.idempotencyKey,missionId:"m1",agentId:"a1",tool:"echo",action:"echo",
  status:"completed" as const,createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),data:"done"
}]);
const otherState=await store.get("other-key");
if(!otherState)throw new Error("Recovery restore removed another mission's idempotency state.");
const replay=await store.begin(request);
if(!replay.replay||replay.record.data!=="done")throw new Error("Persistent completed operation was not replayed.");

await rm(dir,{recursive:true,force:true});
console.log("Persistent idempotency concurrency test passed.");
