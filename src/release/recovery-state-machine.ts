export type RecoveryState="idle"|"checking"|"recovering"|"rolled_back"|"verifying"|"verified"|"halted";

const allowed:Record<RecoveryState,RecoveryState[]>={
 idle:["checking"],
 checking:["recovering","verified","halted"],
 recovering:["rolled_back","halted"],
 rolled_back:["verifying","halted"],
 verifying:["verified","halted"],
 verified:[],
 halted:[]
};

export class RecoveryStateMachine{
 private state:RecoveryState="idle";

 current():RecoveryState{return this.state;}

 transition(next:RecoveryState):void{
  if(!allowed[this.state].includes(next)){
   throw new Error("Invalid recovery state transition: "+this.state+" -> "+next);
  }
  this.state=next;
 }

 reset():void{
  this.state="idle";
 }
}
