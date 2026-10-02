import {AutomaticTestSelector} from "../src/core/test-selection.js";
import type {ImpactAnalysisResult} from "../src/core/impact-analysis.js";

const selector=new AutomaticTestSelector();
const impact:ImpactAnalysisResult={projectId:"demo",query:"auth",generatedAt:new Date().toISOString(),matchedFiles:["src/auth.ts"],affectedFiles:["src/auth.ts","src/app.ts"],affectedTests:["tests/auth.test.ts"],affectedRoutes:[],affectedEntries:["src/app.ts"],dependencyPackages:[],risk:"medium",score:40,reasons:[],recommendations:[]};
const graph={projectId:"demo",generatedAt:new Date().toISOString(),truncated:false,nodes:[
 {id:"src/auth.ts",kind:"file",path:"src/auth.ts",category:".ts"},
 {id:"tests/auth.test.ts",kind:"test",path:"tests/auth.test.ts",category:".ts"}
],edges:[{from:"tests/auth.test.ts",to:"src/auth.ts",kind:"test"}],entryPoints:[],routes:[],tests:["tests/auth.test.ts"],dependencies:{}};
const result=selector.select(graph,impact);
if(result.tests.length!==1||result.tests[0]!=="tests/auth.test.ts")throw new Error("Automatic test selection failed.");
console.log("Automatic test selection tests passed.");
