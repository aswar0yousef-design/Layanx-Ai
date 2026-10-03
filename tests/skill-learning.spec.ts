import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SkillLearningEngine} from "../src/skills/learning.js";

const dir=mkdtempSync(join(tmpdir(),"layanx-skill-"));
const engine=new SkillLearningEngine(dir);
const pending=engine.propose({missionId:"m1",projectId:"p1",goal:"Process shipping invoices",steps:[{tool:"email.invoices.scan",action:"scan invoices",ok:true},{tool:"google.sheets.append",action:"append sheet rows",ok:true}],outcome:"success",lesson:"Verify the sheet write before recording success."});
assert.equal(pending.manifest.status,"quarantined");
assert.equal(pending.findings.safe,true);
assert.equal(engine.list().length,1);
const approved=engine.approve(pending.id);
assert.equal(approved.manifest.status,"approved");
assert.match(readFileSync(join(dir,pending.id+".json"),"utf8"),/Verify the sheet write/);
assert.equal(readdirSync(dir).length,1);
assert.throws(()=>engine.propose({missionId:"m2",projectId:"p1",goal:"bad",steps:[],outcome:"failure"}),/successful/);
console.log("skill-learning.spec.ts passed");
