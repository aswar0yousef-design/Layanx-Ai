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
  private capturing=false;
  private sequence=0;
  private frame?:LiveScreenFrame;

  constructor(private readonly options:LiveScreenObserverOptions){
    this.intervalMs=Math.min(Math.max(Math.floor(options.intervalMs??500),100),5000);
  }

  isRunning(){return this.running;}
  latest(){return this.frame?{...this.frame}:undefined;}

  async captureNow():Promise<LiveScreenFrame>{
    if(this.capturing&&this.frame)return this.frame;
    this.capturing=true;
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
      const data=result&&typeof result==="object"&&"data" in result&&result.data&&typeof result.data==="object"?(result.data as Record<string,unknown>):{};
      if(typeof data.base64!=="string"||typeof data.mimeType!=="string")throw new Error("Desktop screenshot adapter returned an invalid frame.");
      const bytes=typeof data.bytes==="number"?data.bytes:Buffer.from(data.base64,"base64").length;
      const frame={mimeType:data.mimeType,base64:data.base64,bytes,capturedAt:new Date().toISOString(),sequence:++this.sequence};
      this.frame=frame;
      return frame;
    } finally {this.capturing=false;}
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
