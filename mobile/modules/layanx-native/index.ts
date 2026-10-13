import {requireOptionalNativeModule} from "expo";

/** What the PC answers to a decision made on the phone (after the fingerprint). */
export type DecideResult={ok:boolean;status?:number;message?:string;continuing?:"job"|"tool"|"mission"|null;cancelled?:boolean};

interface LayanXNativeModule{
  /** HTTPS to the PC; an IP address must present the certificate whose SHA-256 is `pin`. */
  request(url:string,pin:string|null,token:string|null,method:string,path:string,body:string|null,timeoutMs:number):Promise<{status:number;body:string}>;
  /** The paired PC for the background parts: {name, deviceId, urls, pin, token, projectId}. */
  saveDevice(json:string):Promise<boolean>;
  clearDevice():Promise<boolean>;
  /** Follow the PC in the background (approvals, running mission, widget). */
  setWatching(on:boolean):Promise<boolean>;
  isWatching():boolean;
  /** Fingerprint screen, then the decision bound to the request's digest. Resolves with JSON. */
  decide(approvalJson:string,decision:"approve"|"revoke"):Promise<string>;
  /** 0 = fingerprint or screen lock ready. */
  authStatus():number;
  ignoringBatteryOptimizations():boolean;
  openBatterySettings():Promise<boolean>;
  /** "Ask LayanX" by voice (same screen as the Quick Settings tile). */
  ask():Promise<boolean>;
}

/** Android only; null on iOS and in Expo Go, where the app falls back to plain fetch. */
export const LayanXNative=requireOptionalNativeModule<LayanXNativeModule>("LayanXNative");
