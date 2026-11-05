import {strict as assert} from "node:assert";
import {test} from "node:test";
import {SpeechTurnCoordinator} from "../src/voice/speech-turn-coordinator.js";
test("interrupt cancels current speech and rejects stale callbacks",()=>{
 const c=new SpeechTurnCoordinator();
 const first=c.listen();
 assert.equal(c.thinking(first.turnId),true);
 assert.equal(c.speaking(first.turnId),true);
 c.interrupt();
 assert.equal(first.signal.aborted,true);
 assert.equal(c.finish(first.turnId),false);
 assert.equal(c.snapshot().state,"idle");
 const next=c.listen();
 assert.equal(c.speaking(next.turnId),true);
 assert.equal(c.finish(next.turnId),true);
});
test("new listening turn aborts previous recognition",()=>{
 const c=new SpeechTurnCoordinator(),a=c.listen(),b=c.listen();
 assert.equal(a.signal.aborted,true);
 assert.equal(c.thinking(a.turnId),false);
 assert.equal(c.thinking(b.turnId),true);
});
