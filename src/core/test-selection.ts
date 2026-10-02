import type {ImpactAnalysisResult} from "./impact-analysis.js";
import type {ProjectGraphResult} from "./project-graph.js";

export interface TestSelectionResult{
  projectId:string;
  tests:string[];
  skippedReason?:string;
  generatedAt:string;
}

export class AutomaticTestSelector{
  select(graph:ProjectGraphResult,impact:ImpactAnalysisResult):TestSelectionResult{
    const selected=new Set<string>(impact.affectedTests);
    for(const edge of graph.edges){
      if(edge.kind!=="test")continue;
      if(impact.affectedFiles.includes(edge.to))selected.add(edge.from);
    }
    const tests=[...selected].filter(path=>graph.tests.includes(path)).sort();
    return{
      projectId:graph.projectId,
      tests,
      skippedReason:tests.length?undefined:"No graph-linked tests were identified for the requested change.",
      generatedAt:new Date().toISOString()
    };
  }
}
