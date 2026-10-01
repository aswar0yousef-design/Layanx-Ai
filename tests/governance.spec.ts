import {BudgetGovernor} from "../src/core/budget-governor.js";
import {NoActionController} from "../src/core/no-action.js";
const governor=new BudgetGovernor({maxToolCalls:2,maxRuntimeMs:1000,maxCostUsd:1});
const blocked=governor.evaluate({toolCalls:2,runtimeMs:100,costUsd:0});
if(blocked.allowed)throw new Error("Budget governor failed.");
const noAction=new NoActionController().evaluate({risk:"low",hasRequiredApproval:true,budgetAvailable:true,goalRequiresAction:false});
if(noAction!=="no-action")throw new Error("No-action decision failed.");
console.log("Governance test passed.");
