export type ActionDecision="execute"|"wait"|"no-action"|"request-approval";
export interface DecisionInput{risk:"low"|"medium"|"high"|"critical";hasRequiredApproval:boolean;budgetAvailable:boolean;goalRequiresAction:boolean;}
export class DecisionEngine{
 decide(input:DecisionInput):ActionDecision{
  if(!input.goalRequiresAction)return"no-action";
  if(!input.budgetAvailable)return"wait";
  if((input.risk==="high"||input.risk==="critical")&&!input.hasRequiredApproval)return"request-approval";
  return"execute";
 }
}
