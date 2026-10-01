import type {DecisionInput} from "./decision.js";
import {DecisionEngine} from "./decision.js";
export class NoActionController{
 constructor(private readonly decisions=new DecisionEngine()){}
 evaluate(input:DecisionInput){return this.decisions.decide(input);}
}
