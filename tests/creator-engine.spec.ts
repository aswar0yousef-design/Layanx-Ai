import assert from "node:assert/strict";
import {existsSync,rmSync} from "node:fs";
import {join} from "node:path";
import {CreatorEngine} from "../src/creator/engine.js";
const root=join(process.cwd(),".test-creator");rmSync(root,{recursive:true,force:true});
const engine=new CreatorEngine({root,generateText:async()=>JSON.stringify({title:"اختبار",hook:"هل تعلم؟",script:"الجملة الأولى. الجملة الثانية. الجملة الثالثة."})});
const project=await engine.plan({topic:"اختبار",platform:"both",durationSec:30});assert.equal(project.title,"اختبار");assert.equal(project.scenes.length,3);assert.equal(project.aspectRatio,"9:16");assert.ok(existsSync(join(root,project.id,"project.json")));
await assert.rejects(()=>engine.render(project.id),/creator_scene_assets_required/);const report=await engine.doctor();assert.equal(report.outputDir,root);assert.equal(report.providers.length,4);rmSync(root,{recursive:true,force:true});console.log("creator-engine.spec.ts passed");
