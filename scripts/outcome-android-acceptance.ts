/**
 * Android Studio acceptance on this PC: LayanX creates a Kotlin + Compose project, builds the APK and runs
 * its unit tests with the project's own Gradle wrapper — the same project Android Studio opens.
 *   npx tsx scripts/outcome-android-acceptance.ts [--open]   (--open also opens it in Android Studio)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-android-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
const {createProjectRunnerAdapter}=await import("../src/autonomy/project-runner.js");
const {androidToolchain}=await import("../src/autonomy/android.js");
const run=createProjectRunnerAdapter();
const call=async(task:string,extra:Record<string,unknown>={})=>await run.execute({projectId:"expenses",tool:"project.run",action:"run project task",payload:{task,...extra}} as never) as Record<string,any>;

console.log("toolchain",JSON.stringify(androidToolchain()));
const created=await call("android:create",{appName:"Expenses",packageId:"com.layanx.expenses"});
console.log("create",created.created,created.wrapper?.ok,created.wrapper?.detail?.slice(0,300));
if(!created.created||!created.wrapper?.ok)process.exit(1);
const detect=await call("detect");
console.log("detect",detect.stack,detect.tasks.join(","));
const t0=Date.now();
const build=await call("build");
console.log("build",build.ok,build.exitCode,Math.round((Date.now()-t0)/1000)+"s",build.ok?"":(build.stdout+build.stderr).slice(-3000));
const apk=path.join(root,"expenses","app","build","outputs","apk","debug","app-debug.apk");
console.log("apk",fs.existsSync(apk)?fs.statSync(apk).size+" bytes":"missing");
const test=await call("test");
console.log("test",test.ok,test.exitCode,test.ok?"":(test.stdout+test.stderr).slice(-2000));
if(process.argv.includes("--open"))console.log("studio",JSON.stringify(await call("studio:open")));
console.log("project",path.join(root,"expenses"));
process.exit(build.ok&&test.ok&&fs.existsSync(apk)?0:1);
