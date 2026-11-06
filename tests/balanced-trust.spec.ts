import {strict as assert} from "node:assert";
import {test} from "node:test";
import {trustAllows,trustLevel} from "../src/autonomy/trust.js";

test("balanced trust auto-approves only limited low-risk operations",()=>{
 const env={LAYANX_DEFAULT_TRUST:"balanced"};
 assert.equal(trustLevel("sample",env),"balanced");
 for(const tool of ["project.verify","browser.test","desktop.app.open","git.branch"])
   assert.equal(trustAllows(tool,"sample",env),true,tool);
 for(const tool of ["terminal.exec","files.write","project.run","git.push","git.merge","agent.external","desktop.keyboard.type","vercel.promote"])
   assert.equal(trustAllows(tool,"sample",env),false,tool);
});
test("supervised remains default",()=>{
 assert.equal(trustLevel("sample",{}),"supervised");
 assert.equal(trustAllows("desktop.app.open","sample",{}),false);
});
