import {requireOptionalNativeModule} from "expo";

export type LinkedDevice={id:string;name:string;computer?:string;installId?:string;lastUrl?:string;urls:string[]};
export type LinkResponse={status:number;contentType?:string;body?:string;base64:boolean;url?:string};
export type AuthOutcome="ok"|"cancelled"|"unavailable";

interface LayanxNativeModule{
  pair(link:string,phoneName:string):Promise<LinkedDevice>;
  devices():Promise<{devices:LinkedDevice[];selected:string|null;live:boolean}>;
  select(id:string):Promise<boolean>;
  removeDevice(id:string):Promise<boolean>;
  request(options:{deviceId?:string;method:string;path:string;body?:string;bodyType?:string;base64?:boolean;timeoutMs?:number}):Promise<LinkResponse>;
  setLive(on:boolean):Promise<boolean>;
  authenticate(title:string,subtitle:string|null):Promise<AuthOutcome>;
  startRecording():Promise<boolean>;
  stopRecording():Promise<{base64:string;durationMs:number}|null>;
  cancelRecording():Promise<boolean>;
}

/** Null outside the Android build (the encrypted link, notifications and the fingerprint are Android code). */
export const LayanxNative=requireOptionalNativeModule<LayanxNativeModule>("LayanxNative");
