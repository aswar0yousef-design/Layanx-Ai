/**
 * Which local speech-to-text server to use (both speak the OpenAI-compatible /v1/audio/transcriptions API):
 *   cohere  - Cohere Transcribe Arabic on 127.0.0.1:8181 (scripts\windows\install-cohere-asr.ps1), best for dialects
 *   whisper - whisper.cpp's whisper-server on 127.0.0.1:8178 (scripts\windows\install-whisper.ps1)
 * LAYANX_STT_ENGINE = auto (default: Cohere when it runs, else Whisper) | cohere | whisper.
 */
export interface LocalStt{engine:"cohere"|"whisper";baseUrl:string;ready?:boolean}
export async function detectLocalStt(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):Promise<LocalStt|null>{
  const pref=(env.LAYANX_STT_ENGINE??"auto").trim().toLowerCase();
  const cohere=Number(env.LAYANX_COHERE_PORT)||8181,whisper=Number(env.LAYANX_STT_PORT)||8178;
  const tryCohere=async():Promise<LocalStt|null>=>{
    try{const r=await fetcher(`http://127.0.0.1:${cohere}/`,{signal:AbortSignal.timeout(800)});if(!r.ok)return null;
      const d=await r.json() as {engine?:string;ready?:boolean;ok?:boolean};
      return d.engine==="cohere-transcribe-arabic"&&d.ok!==false?{engine:"cohere",baseUrl:`http://127.0.0.1:${cohere}/v1`,ready:Boolean(d.ready)}:null;}catch{return null;}
  };
  const tryWhisper=async():Promise<LocalStt|null>=>{
    try{const r=await fetcher(`http://127.0.0.1:${whisper}/`,{signal:AbortSignal.timeout(800)});return r.status<500?{engine:"whisper",baseUrl:`http://127.0.0.1:${whisper}/v1`}:null;}catch{return null;}
  };
  const order=pref==="whisper"?[tryWhisper]:pref==="cohere"?[tryCohere]:[tryCohere,tryWhisper];
  for(const probe of order){const found=await probe();if(found)return found;}
  return null;
}
