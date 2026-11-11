import assert from "node:assert/strict";
import {jobNotice,jobNotifier} from "../src/platform/desktop-notify.js";

const job={id:"abcdef123456",goal:"ابن موقع مقهى\nبقية التفاصيل",projectId:"cafe"};
// "Finished" is said only when the recorded outcome is verified.
assert.equal(jobNotice({...job,outcome:{status:"verified"}},"completed")!.title,"اكتمل المشروع ونجحت فحوصه");
assert.equal(jobNotice({...job,outcome:{status:"blocked"}},"completed")!.title,"انتهى المشروع دون إثبات كامل");
assert.equal(jobNotice(job,"completed")!.title,"انتهى المشروع دون إثبات كامل");
assert.match(jobNotice(job,"failed")!.body,/cafe\/\.layanx\/HANDOFF\.md/);
assert.equal(jobNotice(job,"failed")!.body.includes("بقية التفاصيل"),false);
// Progress is not worth interrupting anyone for.
for(const status of ["running","planning","verifying","queued"])assert.equal(jobNotice(job,status),undefined);
// One notification per state; waiting again after work resumed is a new event.
const shown:string[]=[];
const notify=jobNotifier((title)=>{shown.push(title);});
notify(job,"waiting_approval");notify(job,"waiting_approval");
assert.equal(shown.length,1);
notify(job,"running");notify(job,"waiting_approval");
assert.equal(shown.length,2);
notify({...job,outcome:{status:"verified"}},"completed");notify({...job,outcome:{status:"verified"}},"completed");
assert.equal(shown.length,3);
// A failing notification never reaches the job.
jobNotifier(()=>Promise.reject(new Error("no notifications")))(job,"failed");
console.log("desktop-notify: says finished only when verified, and announces each state once");
