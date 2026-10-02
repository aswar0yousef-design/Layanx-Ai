import {mkdtemp,writeFile,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AutomaticTestRunner} from "../src/core/test-runner.js";

const root=await mkdtemp(join(tmpdir(),"layanx-test-runner-"));
await mkdir(join(root,"tests"),{recursive:true});
await writeFile(join(root,"node_modules-marker"),"");
const runner=new AutomaticTestRunner({root,timeoutMs:5000});
const empty=await runner.run([]);
if(empty.ok||empty.error!=="No tests were selected.")throw new Error("Empty selection handling failed.");
const escape=await runner.run(["../outside.test.ts"]);
if(escape.ok||!escape.error?.includes("escapes"))throw new Error("Workspace escape protection failed.");
console.log("Automatic test runner tests passed.");
