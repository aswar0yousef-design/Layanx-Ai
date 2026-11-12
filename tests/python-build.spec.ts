import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildPlan,isBuildProfile,nodeSpecPrompt,pythonFileFor,pythonProgramPrompt,pythonSpecFiles,PYTHON_TOOL_PROFILE} from "../src/autonomy/project-build.js";
import {reviewTestSource} from "../src/autonomy/peer-review.js";
import {newProjectKind} from "../src/voice/project-intent.js";

// Seen live 2026-11-12: the Python script worked 4 times out of 4 and was reported failed each time on the general path.
assert.equal(newProjectKind("اكتب لي سكربت بايثون اسمه sum_column.py يجمع عموداً"),"python-tool");
assert.equal(newProjectKind("ابن لي موقع بايثون فيه api"),"general","a Python site or server is not a script");
assert.equal(pythonFileFor("اكتب سكربت اسمه sum_column.py"),"sum_column.py");
assert.equal(pythonFileFor("python script that adds numbers"),"main.py");
assert.ok(isBuildProfile(PYTHON_TOOL_PROFILE));
assert.deepEqual(buildPlan(PYTHON_TOOL_PROFILE,"x","/nowhere").milestones.map(m=>m.stage),["spec","code"]);
assert.match(nodeSpecPrompt("x",undefined,"Python"),/command-line Python program/);

const python=spawnSync(process.platform==="win32"?"python":"python3",["--version"],{encoding:"utf8"});
if(python.status!==0){console.log("python-build: Python is not installed here; the run-the-script part was skipped");process.exit(0);}
const goal="sum_column.py: prints the sum of a CSV column";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"py-build-"));
// Input files come with the case (a CSV the script reads), parsed exactly as a model's cases are.
const {parseReviewCases}=await import("../src/autonomy/peer-review.js");
const cases=parseReviewCases({cases:[{args:["data.csv","amount"],stdin:"",code:0,stdout:"60.5",why:"sums the column",files:{"data.csv":"name,amount\\nx,10\\ny,20.5\\nz,30\\n"}},{args:["data.csv","missing"],stdin:"",code:1,stdout:"",why:"unknown column",files:{"data.csv":"name,amount\nx,1\n","../evil":"no"}}]},8);
assert.deepEqual(Object.keys(cases[1]!.files!),["data.csv"],"only simple file names are kept");
assert.equal(cases[0]!.files!["data.csv"],"name,amount\nx,10\ny,20.5\nz,30\n","escaped line breaks become real ones");
for(const f of pythonSpecFiles(goal,reviewTestSource(cases))){fs.mkdirSync(path.dirname(path.join(dir,f.path)),{recursive:true});fs.writeFileSync(path.join(dir,f.path),f.content);}
assert.ok(!fs.existsSync(path.join(dir,"data.csv")),"no input file in the project: each test makes its own");
const run=()=>spawnSync(process.execPath,["--test"],{cwd:dir,encoding:"utf8",windowsHide:true,timeout:60_000});
assert.notEqual(run().status,0,"the tests fail against the placeholder");
fs.writeFileSync(path.join(dir,"sum_column.py"),`import csv,sys
path,col=sys.argv[1],sys.argv[2]
with open(path,newline="",encoding="utf-8") as f:
    r=csv.DictReader(f)
    if col not in (r.fieldnames or []):
        print("no such column: "+col,file=sys.stderr);sys.exit(1)
    total=sum(float(x[col]) for x in r)
print(int(total) if total==int(total) else total)
`);
const good=run();
assert.equal(good.status,0,good.stdout.slice(-1200));
assert.match(pythonProgramPrompt(goal,dir),/python sum_column\.py <args>/);
fs.rmSync(dir,{recursive:true,force:true});
console.log("python-build: cases written first and locked; the tests run the real Python script, failing an empty one and passing a correct one");
// The model's output is held to a JSON schema; without "files" in it, input files could never be written (seen live).
assert.match(fs.readFileSync(new URL("../src/autonomy/supervisor.ts",import.meta.url),"utf8"),/const CASES_SCHEMA=[^\n]*files:\{type:"object"/);
