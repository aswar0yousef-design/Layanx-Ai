import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {listIntake,requestIntake} from "./integration-intake.js";
import {readLedger} from "./improvement-cycle.js";

/** The agent may ask to bring in outside code and may read how its experiments went. Approving is deliberately not a tool. */
export function registerIntakeTools(core:LayanXCore,paths:{intakeRoot:string;ledgerFile:string}){
  const tools:Array<[string,string,"L1_READ"|"L3_MODIFY",(p:any)=>unknown]>=[
    ["integration.intake.request","fetch one exact version of a repository or package into quarantine and scan it, without running it, for the owner to decide","L3_MODIFY",p=>requestIntake({source:p.source,target:String(p.target??""),ref:String(p.ref??""),why:String(p.why??"")},{root:paths.intakeRoot})],
    ["integration.intake.list","list outside code requests and their scan results","L1_READ",()=>listIntake(paths.intakeRoot)],
    ["improvement.ledger","read which measured self-improvement experiments were kept or rejected and why","L1_READ",()=>readLedger(paths.ledgerFile).entries.slice(-30)]
  ];
  for(const[name,description,permission,handler]of tools){
    core.tools.register({name,description,permission,dangerous:false,actions:[name],tags:["self-improvement"]});
    const adapter:ToolAdapter={async execute(request){return handler(request.payload??{});}};
    core.toolAdapters.register(name,adapter);
  }
}
