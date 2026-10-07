/**
 * One-click local entry point (used by LayanX.cmd / scripts/windows/start.ps1).
 *
 *   npm run local
 *
 * Loads secrets from the encrypted per-user store, adapts to the Ollama models
 * installed on this machine, starts the existing API on a private loopback port
 * and puts the authenticated gateway + setup page in front of it.
 */
import {runLocalHost} from "./local/host.js";

runLocalHost().catch(error=>{
  console.error("[layanx-local] fatal:",error instanceof Error?error.stack??error.message:error);
  process.exit(1);
});
