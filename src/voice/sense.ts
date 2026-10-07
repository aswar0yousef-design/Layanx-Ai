/**
 * Voice sense on this computer (scripts/voice-sense/server.py, started by LayanX.cmd on port 8180):
 *   vad  - Silero VAD: is there real speech in this clip? Silent or noisy clips never reach Whisper,
 *          which otherwise "hears" words in noise (and wakes the assistant by mistake).
 *   turn - Smart Turn v3.2: has the speaker finished? The assistant answers right after a finished
 *          sentence instead of waiting a fixed pause, and waits longer while the user is mid-sentence.
 */
export interface VadResult{speech:boolean;maxProb:number;speechMs:number;durationMs:number}
export interface TurnResult{complete:boolean;probability:number;ms?:number}
export class VoiceSense{
  readonly baseUrl:string;
  constructor(baseUrl:string,private readonly timeoutMs=5000){this.baseUrl=baseUrl.replace(/\/+$/,"");}
  static fromEnv(env:NodeJS.ProcessEnv=process.env):VoiceSense|null{
    const url=env.LAYANX_VOICE_SENSE_URL?.trim();
    return url?new VoiceSense(url):null;
  }
  private async post<T>(path:string,wav:Buffer):Promise<T>{
    const r=await fetch(this.baseUrl+path,{method:"POST",headers:{"content-type":"audio/wav"},body:new Uint8Array(wav),signal:AbortSignal.timeout(this.timeoutMs)});
    if(!r.ok)throw new Error(`voice sense ${path} failed (${r.status}): ${(await r.text()).slice(0,200)}`);
    return await r.json() as T;
  }
  vad(wav:Buffer):Promise<VadResult>{return this.post<VadResult>("/vad",wav);}
  turn(wav:Buffer):Promise<TurnResult>{return this.post<TurnResult>("/turn",wav);}
}
/** PCM WAV (RIFF....WAVE) - the only format the sense server reads. */
export function isWav(audio:Buffer):boolean{return audio.length>44&&audio.toString("ascii",0,4)==="RIFF"&&audio.toString("ascii",8,12)==="WAVE";}
