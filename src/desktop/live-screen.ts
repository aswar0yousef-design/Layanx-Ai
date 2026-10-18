import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";

export interface LiveScreenFrame {
  mimeType:string;
  base64:string;
  bytes:number;
  capturedAt:string;
  sequence:number;
}

export interface LiveScreenObserverOptions {
  intervalMs?:number;
  adapter:ToolAdapter;
  requestFactory?:()=>ToolRequest;
}

export class LiveScreenObserver {
  private readonly intervalMs:number;
  private timer?:ReturnType<typeof setInterval>;
  private running=false;
  private inFlight?:Promise<LiveScreenFrame>;
  private sequence=0;
  private frame?:LiveScreenFrame;
  private lastError?:string;

  constructor(private readonly options:LiveScreenObserverOptions){
    this.intervalMs=Math.min(Math.max(Math.floor(options.intervalMs??500),100),5000);
  }

  isRunning(){return this.running;}
  latest(){return this.frame?{...this.frame}:undefined;}
  lastErrorMessage(){return this.lastError;}

  captureNow():Promise<LiveScreenFrame>{
    if(this.inFlight)return this.inFlight;
    const work=this.captureFrame();
    this.inFlight=work;
    return work.finally(()=>{if(this.inFlight===work)this.inFlight=undefined;});
  }

  private async captureFrame():Promise<LiveScreenFrame>{
    try{
      const request=this.options.requestFactory?.()??{
        missionId:"live-screen",
        agentId:"core",
        projectId:"default",
        tool:"desktop.screenshot",
        action:"desktop screenshot",
        permission:"L2_ANALYZE" as const,
        idempotencyKey:"live-screen",
        payload:{}
      };
      const result=await this.options.adapter.execute(request);
      const envelope=result&&typeof result==="object"&&!Array.isArray(result)
        ?result as Record<string,unknown>:{};
      // Runtime wires the raw desktop.screenshot adapter here, which returns the
      // frame directly. Also accept ToolExecutor's {ok, data} envelope for callers
      // that route through the executor rather than the adapter registry.
      if(envelope.ok===false){
        throw new Error(typeof envelope.error==="string"?envelope.error:"Desktop screenshot adapter failed.");
      }
      const nested=envelope.data;
      const data=nested&&typeof nested==="object"&&!Array.isArray(nested)
        ?nested as Record<string,unknown>:envelope;
      if(typeof data.base64!=="string"||!data.base64||typeof data.mimeType!=="string"||!data.mimeType.startsWith("image/")){
        throw new Error("Desktop screenshot adapter returned an invalid frame.");
      }
      const bytes=typeof data.bytes==="number"?data.bytes:Buffer.from(data.base64,"base64").length;
      if(bytes<=0)throw new Error("Desktop screenshot adapter returned an empty frame.");
      const frame={mimeType:data.mimeType,base64:data.base64,bytes,capturedAt:new Date().toISOString(),sequence:++this.sequence};
      this.frame=frame;
      this.lastError=undefined;
      return frame;
    }catch(error){
      this.lastError=(error instanceof Error?error.message:String(error)).slice(0,500);
      throw error;
    }
  }

  start(){
    if(this.running)return;
    this.running=true;
    void this.captureNow().catch(()=>{});
    this.timer=setInterval(()=>{void this.captureNow().catch(()=>{});},this.intervalMs);
  }

  stop(){
    this.running=false;
    if(this.timer)clearInterval(this.timer);
    this.timer=undefined;
  }
}
