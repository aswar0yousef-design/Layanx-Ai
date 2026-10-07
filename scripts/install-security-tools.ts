/**
 * Installs the optional security scanners (gitleaks, osv-scanner, opengrep) into the LayanX tools
 * folder: exact pinned versions only, each download checked against its published SHA-256.
 *   node node_modules/tsx/dist/cli.mjs scripts/install-security-tools.ts [gitleaks osv-scanner opengrep]
 */
import {PINNED_TOOLS,installPinnedTool,installedTool,toolsDir} from "../src/platform/tool-installer.js";

if(process.platform!=="win32"){console.log("These pinned downloads are for Windows. On Linux/macOS install gitleaks, osv-scanner and opengrep with your package manager; LayanX finds them on PATH.");process.exit(0);}
const wanted=process.argv.slice(2);
const dir=toolsDir();
let failed=0;
for(const tool of PINNED_TOOLS.filter(t=>!wanted.length||wanted.includes(t.name))){
  if(installedTool(tool.name,dir)){console.log(`${tool.name} ${tool.version}: already installed and verified`);continue;}
  try{const e=await installPinnedTool(tool,{dir,log:m=>console.log("  "+m)});console.log(`${tool.name} ${e.version}: installed (${tool.license})`);}
  catch(error){failed++;console.error(`${tool.name}: ${error instanceof Error?error.message:String(error)}`);}
}
console.log("Tools folder: "+dir);
process.exit(failed?1:0);
