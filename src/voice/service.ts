export interface VoiceStatus {
  enabled:boolean;
  provider:string;
  transcriptionModel:string;
  speechModel:string;
  voice:string;
  reason?:string;
}

export interface VoiceProvider {
  readonly name:string;
  status():VoiceStatus;
  transcribe(audio:Buffer,mimeType:string,filename:string,language?:string):Promise<string>;
  speak(text:string,format?:"mp3"|"wav"|"opus"):Promise<{audio:Buffer;contentType:string}>;
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
}

export class VoiceService{
  constructor(private readonly provider:VoiceProvider=new OpenAIVoiceProvider()){}
  status(){return this.provider.status();}
  transcribe(...args:Parameters<VoiceProvider["transcribe"]>){return this.provider.transcribe(...args);}
  speak(...args:Parameters<VoiceProvider["speak"]>){return this.provider.speak(...args);}
}
