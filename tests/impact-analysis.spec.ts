import {ChangeImpactAnalyzer} from "../src/core/impact-analysis.js";
const analyzer=new ChangeImpactAnalyzer();
const graph={projectId:"demo",generatedAt:new Date().toISOString(),truncated:false,nodes:[
{id:"src/auth.ts",kind:"file",path:"src/auth.ts",category:".ts"},
{id:"src/app.ts",kind:"entry",path:"src/app.ts",category:".ts"},
{id:"tests/auth.test.ts",kind:"test",path:"tests/auth.test.ts",category:".ts"}
],edges:[
{from:"src/app.ts",to:"src/auth.ts",kind:"import"},
{from:"tests/auth.test.ts",to:"src/auth.ts",kind:"test"}
],entryPoints:["src/app.ts"],routes:[],tests:["tests/auth.test.ts"],dependencies:{}};
const result=analyzer.analyze(graph,"auth");
if(!result.matchedFiles.includes("src/auth.ts"))throw new Error("Direct impact match failed.");
if(!result.affectedFiles.includes("src/app.ts"))throw new Error("Reverse import impact failed.");
if(!result.affectedTests.includes("tests/auth.test.ts"))throw new Error("Affected test detection failed.");
if(result.score<1||!result.recommendations.length)throw new Error("Impact scoring/recommendations failed.");
console.log("Impact analysis tests passed.");
