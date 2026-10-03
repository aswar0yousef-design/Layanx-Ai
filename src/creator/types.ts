export type CreatorPlatform="youtube"|"tiktok"|"both";
export interface CreatorScene{ id:string; index:number; narration:string; visualPrompt:string; durationSec:number; assetPath?:string; }
export interface CreatorProject{ id:string; title:string; topic:string; platform:CreatorPlatform; aspectRatio:"9:16"|"16:9"|"1:1"; language:string; hook:string; script:string; scenes:CreatorScene[]; outputPath?:string; createdAt:string; }
export interface CreatorPlanInput{ topic:string; title?:string; platform?:CreatorPlatform; language?:string; durationSec?:number; style?:string; }
export interface CreatorProviderStatus{ name:string; available:boolean; mode:"local"|"http"|"command"|"builtin"; reason:string; }
export interface CreatorDoctorReport{ ready:boolean; providers:CreatorProviderStatus[]; ffmpeg:boolean; outputDir:string; }
export interface CreatorEngineOptions{ root?:string; generateText?: (prompt:string)=>Promise<string>; }
