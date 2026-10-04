import assert from "node:assert/strict";
import {LayanXCore} from "../src/core/orchestrator.js";
const core=new LayanXCore();
const a=core.scheduler.register({goal:"quran.publish_next",projectId:"quran-channel",trigger:{kind:"daily",hour:8,minute:0},enabled:true});
const b=core.scheduler.register({goal:"quran.publish_next",projectId:"quran-channel",trigger:{kind:"daily",hour:20,minute:0},enabled:true});
assert.equal(a.trigger.kind,"daily");assert.equal(a.trigger.hour,8);assert.equal(b.trigger.hour,20);
assert.throws(()=>core.scheduler.register({goal:"bad",projectId:"quran-channel",trigger:{kind:"daily",hour:24,minute:0}}),/Daily trigger/);
console.log("quran schedule: ok");