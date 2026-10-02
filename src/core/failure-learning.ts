import type {MemoryEngine,MemoryEntry} from "./memory.js";

export type FailureCategory=
  "timeout"|"network"|"rate_limit"|"dependency"|"validation"|"permission"|"approval"|"tool"|"planner"|"verification"|"unknown";

export interface FailureLearningInput{
  missionId:string;
  projectId?:string;
  error?:string;
  tool?:string;
  action?:string;
  context?:unknown;
  recoverable?:boolean;
}

export interface LearnedFailure{
  category:FailureCategory;
  signature:string;
  summary:string;
  similar:MemoryEntry[];
}

export class FailureLearning{
  constructor(private readonly memory:MemoryEngine){}

  record(input:FailureLearningInput):LearnedFailure{
    const category=this.classify(input.error);
    const signature=this.signature(category,input.tool,input.action,input.error);
    const summary="Failure learned: "+category+(input.tool?" in "+input.tool:"");
    this.memory.remember({
      missionId:input.missionId,
      projectId:input.projectId,
      kind:"failure",
      summary,
      content:{category,signature,tool:input.tool,action:input.action,error:input.error,recoverable:input.recoverable,context:input.context},
      confidence:1,
      tags:["failure","learning",category,...(input.tool?[input.tool]:[])]
    });
    const similar=this.memory.recall(signature,5,input.projectId);
    return{category,signature,summary,similar};
  }

  recallSimilar(query:string,projectId?:string,limit=5){
    return this.memory.recall(query,Math.min(Math.max(limit,1),20),projectId)
      .filter(entry=>entry.kind==="failure");
  }

  classify(error?:string):FailureCategory{
    const value=(error??"").toLowerCase();
    if(/timeout|timed out|etimedout/.test(value))return"timeout";
    if(/network|econnreset|eai_again|connection reset|gateway|502|503|504/.test(value))return"network";
    if(/rate.?limit|too many requests|429/.test(value))return"rate_limit";
    if(/dependency|blocked by|prerequisite/.test(value))return"dependency";
    if(/validation|invalid|malformed|schema/.test(value))return"validation";
    if(/permission|unauthorized|forbidden|scope/.test(value))return"permission";
    if(/approval|explicit approval/.test(value))return"approval";
    if(/planner|planning|model/.test(value))return"planner";
    if(/verif|assert|test failed/.test(value))return"verification";
    if(/tool|adapter|execution/.test(value))return"tool";
    return"unknown";
  }

  private signature(category:FailureCategory,tool?:string,action?:string,error?:string){
    const normalized=(error??"").toLowerCase().replace(/[0-9a-f]{8,}/g,"<id>").replace(/\s+/g," ").slice(0,240);
    return[category,tool??"none",action??"none",normalized].join("|");
  }
}
