import {spawn,type ChildProcess} from "node:child_process";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {safeChildEnv} from "../platform/safe-env.js";

export const ISLAND_SCRIPT=fileURLToPath(new URL("../../scripts/windows/island.ps1",import.meta.url));

/**
 * Windows: the desktop island (scripts/windows/island.ps1), a small bar above every window
 * with the running mission and the approvals that wait. It reads /v1/companion/feed over
 * loopback; the token reaches it on standard input, never on the command line or in the
 * environment (-InputFormat None lets the script read it; see the Windows smoke test). It only shows and opens the control center: decisions stay in the control
 * center and on the phone (fingerprint).
 */
export function startDesktopIsland(options:{port:number;dataDir:string;token:string;log:(level:"info"|"warn"|"error",message:string)=>void;
  platform?:NodeJS.Platform;script?:string;spawnFn?:typeof spawn}):ChildProcess|null{
  if((options.platform??process.platform)!=="win32")return null;
  const script=options.script??ISLAND_SCRIPT;
  if(!fs.existsSync(script)){options.log("warn",`desktop island: ${script} is missing`);return null;}
  const child=(options.spawnFn??spawn)("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-STA","-WindowStyle","Hidden","-InputFormat","None","-File",script,"-Port",String(options.port),"-DataDir",options.dataDir],
    {stdio:["pipe","ignore","ignore"],windowsHide:true,env:safeChildEnv()});
  child.on("error",error=>options.log("warn",`desktop island: ${error.message}`));
  child.stdin?.on("error",()=>undefined);
  child.stdin?.end(options.token+"\n");
  child.unref();
  options.log("info","desktop island started (turn it off on the setup page)");
  return child;
}
