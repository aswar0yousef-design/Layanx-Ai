export interface VoiceStatus {
  enabled:boolean;
  /** Local speech-to-text (whisper.cpp or any OpenAI-compatible server) when configured. */
  localStt?:{baseUrl:string;model:string}|null;
  /** Which engine /v1/voice/transcribe uses: "local", "openai" or "none". */
  stt?:"local"|"openai"|"none";
  provider:string;
  transcriptionModel:string;
  speechModel:string;
  voice:string;
  reason?:string;
}

export interface RealtimeClientSecret {
  value:string;
  expiresAt?:number;
  session?:unknown;
}

export interface VoiceProvider {
  readonly name:string;
  status():VoiceStatus;
  transcribe(audio:Buffer,mimeType:string,filename:string,language?:string):Promise<string>;
  speak(text:string,format?:"mp3"|"wav"|"opus"):Promise<{audio:Buffer;contentType:string}>;
  createRealtimeClientSecret?(options?:{model?:string;voice?:string;instructions?:string;safetyIdentifier?:string}):Promise<RealtimeClientSecret>;
}

function audioBaseUrl():string{
  const configured=process.env.OPENAI_AUDIO_BASE_URL?.trim();
  if(configured)return configured.replace(/\/$/,"");
  const base=(process.env.OPENAI_BASE_URL??"https://api.openai.com/v1/responses").replace(/\/$/,"");
  return base.replace(/\/responses$/,"").trim();
}

export class OpenAIVoiceProvider implements VoiceProvider{
  readonly name="openai";
  private readonly apiKey=process.env.OPENAI_API_KEY?.trim();
  private readonly baseUrl=audioBaseUrl();
  private readonly transcriptionModel=process.env.OPENAI_TRANSCRIBE_MODEL??"gpt-4o-mini-transcribe";
  private readonly speechModel=process.env.OPENAI_TTS_MODEL??"gpt-4o-mini-tts";
  private readonly voice=process.env.OPENAI_TTS_VOICE??"alloy";

  status():VoiceStatus{
    const enabled=Boolean(this.apiKey);
    return{enabled,provider:this.name,transcriptionModel:this.transcriptionModel,speechModel:this.speechModel,voice:this.voice,...(!enabled?{reason:"OPENAI_API_KEY is not configured."}:{})};
  }

  private headers():Record<string,string>{
    if(!this.apiKey)throw new Error("OpenAI voice is not configured: OPENAI_API_KEY is required.");
    return{Authorization:`Bearer ${this.apiKey}`};
  }

  async transcribe(audio:Buffer,mimeType:string,filename:string,language?:string):Promise<string>{
    const form=new FormData();
    form.append("file",new Blob([new Uint8Array(audio)],{type:mimeType||"audio/webm"}),filename||"voice.webm");
    form.append("model",this.transcriptionModel);
    if(language?.trim())form.append("language",language.trim());
    const response=await fetch(`${this.baseUrl}/audio/transcriptions`,{method:"POST",headers:this.headers(),body:form});
    if(!response.ok)throw new Error(`Voice transcription failed (${response.status}): ${await response.text()}`);
    const payload=await response.json() as {text?:unknown};
    const text=typeof payload.text==="string"?payload.text.trim():"";
    if(!text)throw new Error("Voice transcription returned no text.");
    return text;
  }

  async speak(text:string,format:"mp3"|"wav"|"opus"="mp3"):Promise<{audio:Buffer;contentType:string}>{
    if(!text.trim())throw new Error("Speech text is empty.");
    const response=await fetch(`${this.baseUrl}/audio/speech`,{
      method:"POST",
      headers:{...this.headers(),"content-type":"application/json"},
      body:JSON.stringify({model:this.speechModel,voice:this.voice,input:text.trim(),response_format:format})
    });
    if(!response.ok)throw new Error(`Voice synthesis failed (${response.status}): ${await response.text()}`);
    return{audio:Buffer.from(await response.arrayBuffer()),contentType:format==="wav"?"audio/wav":format==="opus"?"audio/ogg; codecs=opus":"audio/mpeg"};
  }

  async createRealtimeClientSecret(options:{model?:string;voice?:string;instructions?:string;safetyIdentifier?:string}={}):Promise<RealtimeClientSecret>{
    if(!this.apiKey)throw new Error("OpenAI voice is not configured: OPENAI_API_KEY is required.");
    const session={
      type:"realtime",
      model:options.model??process.env.OPENAI_REALTIME_MODEL??"gpt-realtime-2.1",
      audio:{
        input:{turn_detection:{type:"semantic_vad"}},
        output:{voice:options.voice??process.env.OPENAI_REALTIME_VOICE??"marin"}
      },
      instructions:options.instructions??"You are LayanX voice interface. Speak concise Arabic by default. For project or system actions, use the layanx_execute function. Never claim an action was completed unless the function result confirms it.",
      tools:[{
        type:"function",
        name:"layanx_execute",
        description:"Execute a user-authorized task through the LayanX Runtime. Use this for project inspection, coding, testing, Git, tools, or other system actions.",
        parameters:{
          type:"object",
          properties:{
            goal:{type:"string",description:"The user's requested task."},
            projectId:{type:"string",description:"LayanX project identifier. Use the current project when known."},
            maxSteps:{type:"integer",minimum:1,maximum:25,description:"Maximum autonomous execution steps."}
          },
          required:["goal","projectId"]
        }
      }]
    };
    const response=await fetch(`${this.baseUrl}/realtime/client_secrets`,{
      method:"POST",
      headers:{...this.headers(),"content-type":"application/json",...(options.safetyIdentifier?{"OpenAI-Safety-Identifier":options.safetyIdentifier}:{})},
      body:JSON.stringify({expires_after:{anchor:"created_at",seconds:300},session})
    });
    if(!response.ok)throw new Error(`Realtime client secret failed (${response.status}): ${await response.text()}`);
    const payload=await response.json() as {value?:unknown;expires_at?:unknown;session?:unknown};
    if(typeof payload.value!=="string"||!payload.value)throw new Error("Realtime client secret returned no value.");
    return{value:payload.value,expiresAt:typeof payload.expires_at==="number"?payload.expires_at:undefined,session:payload.session};
  }
}

/**
 * Speech-to-text on this computer. Works with whisper.cpp's whisper-server started with
 * --inference-path /v1/audio/transcriptions, or any OpenAI-compatible transcription server.
 * No API key and no audio leaves the machine.
 */
export class LocalTranscriber{
  readonly baseUrl:string;
  readonly model:string;
  constructor(baseUrl:string,model=process.env.LAYANX_STT_MODEL?.trim()||"whisper-1",private readonly timeoutMs=Number(process.env.LAYANX_STT_TIMEOUT_MS)||60_000){
    this.baseUrl=baseUrl.replace(/\/+$/,"");this.model=model;
  }
  static fromEnv(env:NodeJS.ProcessEnv=process.env):LocalTranscriber|null{
    const url=env.LAYANX_STT_BASE_URL?.trim();
    return url?new LocalTranscriber(url):null;
  }
  async transcribe(audio:Buffer,mimeType:string,filename:string,language?:string):Promise<string>{
    const form=new FormData();
    form.append("file",new Blob([new Uint8Array(audio)],{type:mimeType||"audio/wav"}),filename||"voice.wav");
    form.append("model",this.model);
    form.append("response_format","json");
    form.append("temperature","0");
    const lang=language?.trim().toLowerCase();
    if(lang&&lang!=="auto")form.append("language",lang);
    const response=await fetch(`${this.baseUrl}/audio/transcriptions`,{method:"POST",body:form,signal:AbortSignal.timeout(this.timeoutMs)});
    if(!response.ok)throw new Error(`Local transcription failed (${response.status}): ${(await response.text()).slice(0,300)}`);
    const payload=await response.json() as {text?:unknown};
    return typeof payload.text==="string"?payload.text.trim():"";
  }
}

export class VoiceService{
  private readonly local:LocalTranscriber|null;
  constructor(private readonly provider:VoiceProvider=new OpenAIVoiceProvider(),local:LocalTranscriber|null=LocalTranscriber.fromEnv()){this.local=local;}
  status():VoiceStatus{
    const base=this.provider.status();
    return{...base,localStt:this.local?{baseUrl:this.local.baseUrl,model:this.local.model}:null,stt:this.local?"local":base.enabled?"openai":"none"};
  }
  /** Local whisper first (private, free); the cloud provider only when no local engine is configured. */
  transcribe(...args:Parameters<VoiceProvider["transcribe"]>){return this.local?this.local.transcribe(...args):this.provider.transcribe(...args);}
  speak(...args:Parameters<VoiceProvider["speak"]>){return this.provider.speak(...args);}
  createRealtimeClientSecret(options:{model?:string;voice?:string;instructions?:string;safetyIdentifier?:string}={}){
    if(!this.provider.createRealtimeClientSecret)throw new Error("Realtime voice is not supported by the configured voice provider.");
    return this.provider.createRealtimeClientSecret(options);
  }
}
