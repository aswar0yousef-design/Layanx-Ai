import type {ProjectGraphResult} from "./project-graph.js";

export type ImpactRisk="low"|"medium"|"high"|"critical";
export interface ImpactAnalysisResult{
  projectId:string;
  query:string;
  generatedAt:string;
  matchedFiles:string[];
  affectedFiles:string[];
  affectedTests:string[];
  affectedRoutes:string[];
  affectedEntries:string[];
  dependencyPackages:string[];
  risk:ImpactRisk;
  score:number;
  reasons:string[];
  recommendations:string[];
}

export class ChangeImpactAnalyzer{
  analyze(graph:ProjectGraphResult,query:string):ImpactAnalysisResult{
    const normalized=query.trim().toLowerCase();
    if(!normalized)throw new Error("Change request is required.");
    const tokens=this.tokens(normalized);
    const matched=new Set<string>();
    for(const node of graph.nodes){
      const haystack=node.path.toLowerCase();
      if(tokens.some(token=>haystack.includes(token)))matched.add(node.path);
    }

    const affected=new Set(matched);
    const queue=[...matched];
    while(queue.length){
      const target=queue.shift()!;
      for(const edge of graph.edges){
        if(edge.to===target&&edge.kind==="import"&&!affected.has(edge.from)){
          affected.add(edge.from);queue.push(edge.from);
        }
        if(edge.to===target&&edge.kind==="test")affected.add(edge.from);
      }
    }

    const affectedTests=new Set<string>();
    const affectedRoutes=new Set<string>();
    const affectedEntries=new Set<string>();
    for(const edge of graph.edges){
      if(affected.has(edge.to)||affected.has(edge.from)){
        if(edge.kind==="test")affectedTests.add(edge.from);
      }
    }
    for(const route of graph.routes)if(affected.has(route))affectedRoutes.add(route);
    for(const entry of graph.entryPoints)if(affected.has(entry))affectedEntries.add(entry);

    const dependencyPackages=Object.keys(graph.dependencies).filter(name=>tokens.some(token=>name.toLowerCase().includes(token)));
    const score=this.calculateScore(affected.size,affectedTests.size,affectedRoutes.size,affectedEntries.size,dependencyPackages.length,graph.truncated);
    const risk:ImpactRisk=score>=80?"critical":score>=55?"high":score>=30?"medium":"low";
    const reasons:string[]=[];
    if(!matched.size)reasons.push("No direct file-name match was found; analysis is query-driven and may be incomplete.");
    if(affectedTests.size)reasons.push(affectedTests.size+" related test file(s) are in scope.");
    if(affectedRoutes.size)reasons.push(affectedRoutes.size+" route file(s) may be affected.");
    if(affectedEntries.size)reasons.push(affectedEntries.size+" application entry point(s) are in scope.");
    if(dependencyPackages.length)reasons.push("Dependency package names match the requested change.");
    if(graph.truncated)reasons.push("Project graph was truncated; full impact requires a deeper scan.");
    const recommendations:string[]=[];
    if(affectedTests.size)recommendations.push("Run affected tests before and after modification.");
    else recommendations.push("Select or add tests covering the affected behavior before modifying it.");
    if(affectedRoutes.size)recommendations.push("Run API smoke/contract tests for affected routes.");
    if(affectedEntries.size)recommendations.push("Run an application startup/build check.");
    if(score>=55)recommendations.push("Require explicit approval before L3+ modifications.");
    if(graph.truncated)recommendations.push("Rebuild the graph with a higher file limit before high-risk changes.");
    return{projectId:graph.projectId,query,generatedAt:new Date().toISOString(),matchedFiles:[...matched].sort(),affectedFiles:[...affected].sort(),affectedTests:[...affectedTests].sort(),affectedRoutes:[...affectedRoutes].sort(),affectedEntries:[...affectedEntries].sort(),dependencyPackages, risk,score,reasons,recommendations};
  }

  private tokens(query:string):string[]{
    return [...new Set(query.split(/[^a-z0-9_\u0600-\u06ff.-]+/i).map(token=>token.trim()).filter(token=>token.length>=3))];
  }
  private calculateScore(files:number,tests:number,routes:number,entries:number,packages:number,truncated:boolean):number{
    return Math.min(100,files*6+tests*10+routes*18+entries*12+packages*15+(truncated?20:0));
  }
}
