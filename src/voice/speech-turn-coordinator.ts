/** Provider-neutral speech turn coordinator; does not bypass the existing agent approvals. */
export type SpeechState="idle"|"listening"|"thinking"|"speaking";
export interface SpeechSnapshot {state:SpeechState;turnId:number}
/** Guards against stale TTS/STT callbacks and makes barge-in deterministic. */
export class SpeechTurnCoordinator {
 private state:SpeechState="idle";
 private turnId=0;
 private controller:AbortController|null=null;
 snapshot():SpeechSnapshot{return {state:this.state,turnId:this.turnId};}
 listen():{turnId:number;signal:AbortSignal}{
   this.controller?.abort();
   this.controller=new AbortController();
   this.turnId++;
   this.state="listening";
   return {turnId:this.turnId,signal:this.controller.signal};
 }
 thinking(turnId:number):boolean{return this.transition(turnId,"thinking");}
 speaking(turnId:number):boolean{return this.transition(turnId,"speaking");}
 finish(turnId:number):boolean{return this.transition(turnId,"idle");}
 interrupt():SpeechSnapshot{
   this.controller?.abort();
   this.controller=null;
   this.turnId++;
   this.state="idle";
   return this.snapshot();
 }
 private transition(id:number,state:SpeechState):boolean{
   if(id!==this.turnId||!this.controller||this.controller.signal.aborted)return false;
   this.state=state;return true;
 }
}
