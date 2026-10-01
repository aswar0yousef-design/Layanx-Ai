import {RecoveryStateMachine} from "../src/release/recovery-state-machine.js";

const machine=new RecoveryStateMachine();
if(machine.current()!=="idle")throw new Error("Recovery state did not start idle.");

machine.transition("checking");
machine.transition("recovering");
machine.transition("rolled_back");
machine.transition("verifying");
machine.transition("verified");
if(machine.current()!=="verified")throw new Error("Valid recovery state flow failed.");

let rejected=false;
try{machine.transition("recovering");}catch(error){
 rejected=error instanceof Error&&error.message.includes("Invalid recovery state transition");
}
if(!rejected)throw new Error("Recovery state machine allowed a transition after verification.");

machine.reset();
machine.transition("checking");
machine.transition("recovering");
machine.transition("halted");
if(machine.current()!=="halted")throw new Error("Halted recovery state failed.");

let blocked=false;
try{machine.transition("verifying");}catch(error){
 blocked=error instanceof Error&&error.message.includes("Invalid recovery state transition");
}
if(!blocked)throw new Error("Halted recovery was allowed to continue.");

console.log("Recovery state machine test passed.");
