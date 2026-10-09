import {spawn} from "node:child_process";

/** Only addresses on this PC are opened (a finished project's dev server), never anything from the internet. */
export function isLocalPreview(url:string):boolean{return /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}(\/[\w\-./]*)?$/.test(url);}

/**
 * Open a local address in the default browser on this PC. On Windows through url.dll (no cmd.exe, so no
 * shell parsing of the address); the address is checked first anyway.
 */
export function openInBrowser(url:string,platform:NodeJS.Platform=process.platform):void{
  if(!isLocalPreview(url))throw new Error("Only local addresses (http://localhost:<port>) are opened.");
  const [command,args]=platform==="win32"?["rundll32.exe",["url.dll,FileProtocolHandler",url]]:platform==="darwin"?["open",[url]]:["xdg-open",[url]];
  const child=spawn(command,args,{detached:true,stdio:"ignore"});
  child.on("error",()=>undefined);
  child.unref();
}
