import assert from "node:assert/strict";
import {extractHtml,extractProgram,hasBuiltProgram,nodeSpecFiles,parseSiteSteps,siteSecondOpinionPrompt,siteStepConflicts,testCounts,vacuousTests} from "../src/autonomy/project-build.js";
import {observeTestRun} from "../src/autonomy/node-repair.js";
import {classifyProjectWork,newProjectKind} from "../src/voice/project-intent.js";
import {spawnSync} from "node:child_process";
import {agreedCases,mergeCases,parseReviewCases} from "../src/autonomy/peer-review.js";
import {failureDetails} from "../src/autonomy/node-repair.js";
import {composeTaskServer,decomposeTaskServer} from "../src/autonomy/task-app-verifier.js";

const good=`import test from 'node:test';
import assert from 'node:assert/strict';
import {cli} from './helpers.mjs';
test('a',async()=>{assert.equal((await cli(['1'])).stdout.trim(),'I');});
test('b',async()=>{assert.equal((await cli(['2'])).stdout.trim(),'II');});
test('c',async()=>{assert.equal((await cli(['3'])).stdout.trim(),'III');});
test('d',async()=>{assert.equal((await cli(['0'])).code,1);});
`;
// Tests that only use the program through cli() are accepted.
assert.deepEqual(nodeSpecFiles("roman numerals",good).map(f=>f.path),["package.json","tests/helpers.mjs","tests/spec.test.mjs","src/index.mjs"]);
// A number written in a step has to survive an independent working-out, and the expected value is not shown to it.
const tip=[{action:"fill" as const,selector:"#a",value:"200"},{action:"click" as const,selector:"#b"},{action:"expectText" as const,text:"SECRET 215"}];
assert.equal(siteSecondOpinionPrompt("g",tip).includes("215"),false);
assert.match(siteStepConflicts(tip,{results:["230"]})[0]!,/independently gives "230"/);
assert.deepEqual(siteStepConflicts(tip,{results:["الإجمالي 215"]}),[]);
assert.throws(()=>siteStepConflicts(tip,{}),/invalid JSON/);
// Text is worked out blind too: clicking again with the name still filled cannot show "name required".
const booking=[{action:"fill" as const,selector:"#name",value:"أحمد"},{action:"click" as const,selector:"#book"},{action:"expectText" as const,text:"تم استلام طلبك"},{action:"click" as const,selector:"#book"},{action:"expectText" as const,text:"الاسم مطلوب"}];
assert.equal(siteSecondOpinionPrompt("g",booking).includes("الاسم مطلوب"),false);
assert.deepEqual(siteStepConflicts(booking,{results:["رسالة «تم استلام طلبك»","تم استلام طلبك"]}).length,1);
assert.deepEqual(siteStepConflicts(booking,{results:["تم استلام طلبك!","الاسم مطلوب"]}),[]);
assert.deepEqual(siteStepConflicts(booking,{results:["تم استلام طلبك",""]}),[]);
assert.equal(hasBuiltProgram("does-not-exist"),false);
// The runner's summary is read in both report formats.
assert.deepEqual(testCounts("ℹ tests 5\nℹ pass 1\nℹ fail 4\n"),{tests:5,pass:1,fail:4});
assert.deepEqual(testCounts("# tests 4\n# pass 0\n# fail 4\n"),{tests:4,pass:0,fail:4});
// Tests that pass without a program, or never ran, cannot be locked.
const run=(stdout:string,exitCode=1)=>observeTestRun({exitCode,stdout});
assert.equal(vacuousTests(run("# tests 4\n# pass 0\n# fail 4\n")),undefined);
assert.equal(vacuousTests(run("# tests 4\n# pass 1\n# fail 3\n")),undefined);
// Cases that expect a refusal pass against the empty program, and that is fine while enough others need real output.
assert.equal(vacuousTests(run("# tests 7\n# pass 4\n# fail 3\n")),undefined);
assert.equal(vacuousTests(run("# tests 8\n# pass 5\n# fail 3\n")),undefined);
assert.match(vacuousTests(run("# tests 8\n# pass 6\n# fail 2\n"))!,/refuses everything/);
assert.match(vacuousTests(run("# tests 4\n# pass 3\n# fail 1\n"))!,/refuses everything/);
assert.match(vacuousTests(run("# tests 4\n# pass 4\n",0))!,/no program/);
assert.match(vacuousTests(run("# tests 1\n# pass 0\n# fail 1\nSyntaxError"))!,/did not run properly/);
// Code comes out of a reply, and a reply that was cut off is noticed.
assert.equal(extractProgram("Here:\n```js\nconsole.log('a long enough program');\n```"),"console.log('a long enough program');\n");
assert.match(extractHtml("```html\n<!doctype html><html><body>x</body></html>\n```"),/<\/html>/);
assert.throws(()=>extractHtml("<!doctype html><html><body>cut"),/empty response/);
assert.throws(()=>extractProgram(""),/empty response/);
// Acceptance steps lock only when they check something through plain ids.
assert.equal(parseSiteSteps({steps:[{action:"fill",selector:"#a",value:"1"},{action:"expectText",text:"2"}]}).length,2);
assert.throws(()=>parseSiteSteps({steps:[{action:"click",selector:"#a"},{action:"click",selector:"#b"}]}),/checks a result/);
assert.throws(()=>parseSiteSteps({steps:[{action:"click",selector:"button.x"},{action:"expectText",text:"y"}]}),/simple #id/);
assert.throws(()=>parseSiteSteps({}),/invalid JSON/);
// What the test-first paths can prove goes to them; backends and other platforms stay on the general path.
assert.equal(newProjectKind("اصنع صفحة حاسبة للإكرامية"),"static-site");
assert.equal(newProjectKind("Build a landing page for a cafe"),"static-site");
assert.equal(newProjectKind("اصنع برنامج سطر أوامر يحول الأرقام"),"node-tool");
assert.equal(newProjectKind("create a command-line tool that parses csv"),"node-tool");
assert.equal(newProjectKind("ابن تطبيق قائمة مهام"),"task-app");
assert.equal(newProjectKind("ابن موقع متجر فيه دفع وتسجيل دخول"),"general");
assert.equal(newProjectKind("build a website with a database"),"general");
assert.equal(newProjectKind("اصنع تطبيق اندرويد"),"general");
assert.equal(classifyProjectWork("اعمل صفحة حاسبة"),"build");
assert.equal(classifyProjectWork("create a calculator"),"build");
assert.equal(classifyProjectWork("هل تستطيع عمل صفحة؟"),null);
// A case written with a literal \n means a line break; a program could never pass the literal version.
const literal=parseReviewCases({cases:[{args:[],stdin:"a\\nb\\n",code:0,stdout:'{"lines":2}'}]})[0]!;
assert.equal(literal.stdin,"a\nb\n");
assert.equal(parseReviewCases([{args:[],stdin:"x\ny\\n",code:0,stdout:"a\\nb"}])[0]!.stdin,"x\ny\\n");
assert.equal(parseReviewCases([{args:[],stdin:"",code:0,stdout:"a\\nb"}])[0]!.stdout,"a\nb");
assert.equal(parseReviewCases([{args:[],stdin:"",code:0,stdout:'["a\\nb"]'}])[0]!.stdout,'["a\\nb"]');
assert.equal(agreedCases([literal],[{code:0,stdout:'{"lines": 2}'}]).length,1);
// Confirmed cases survive a bad round, without duplicates.
const one=(stdin:string)=>({args:[],stdin,code:0,stdout:"x",why:""});
assert.deepEqual(mergeCases([one("a"),one("b")],[one("b"),one("c")],8).map(c=>c.stdin),["a","b","c"]);
assert.equal(mergeCases([one("a"),one("b")],[one("c")],2).length,2);
// Every failing test keeps its own actual and expected values.
const detail="✔ fine (1ms)\n✖ failing tests:\n\ntest at tests\\a.mjs:1:1\n✖ first (2ms)\n  AssertionError [ERR_ASSERTION]: x\n  + actual - expected\n    at foo (bar.js:1:1)\n    actual: 1,\n    expected: 2,\n    code: 'ERR_ASSERTION',\n  }\n";
assert.deepEqual(failureDetails(detail).split("\n").map(l=>l.trim()),["✖ failing tests:","✖ first (2ms)","AssertionError [ERR_ASSERTION]: x","+ actual - expected","actual: 1,","expected: 2,"]);
assert.match(observeTestRun({exitCode:1,stdout:detail}).summary,/first[\s\S]*actual: 1,\n\s*expected: 2/);
// The task app is composed from separated Node and browser code, and quoting in one cannot break the other.
const routes="if(req.method==='GET'&&route==='/')return res.end(page);";
const browser="const say=\"it's `fine` ${1}\";document.getElementById('list').textContent=say;";
const server=composeTaskServer(routes,"<script>"+browser+"</script>");
assert.equal(spawnSync(process.execPath,["--check","--input-type=module"],{input:server,encoding:"utf8",windowsHide:true}).status,0);
assert.deepEqual(decomposeTaskServer(server),{routes,browser});
assert.throws(()=>composeTaskServer("document.title='x';",browser),/must not use document/);
assert.throws(()=>composeTaskServer("if(",browser),/routes code does not parse/);
assert.throws(()=>composeTaskServer(routes,"function("),/browser code does not parse/);
assert.throws(()=>composeTaskServer(routes,""),/empty/);
console.log("project-build: checks are written first and locked, vacuous tests are refused, and new projects take the right path");
