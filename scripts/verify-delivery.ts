/** Offline post-handoff integrity audit; does not execute any generated project code. */
import {verifyDeliveryManifest} from "../src/autonomy/delivery.js";
const [workspace,jobId]=process.argv.slice(2);
if(!workspace||!jobId){
  console.error("Usage: npm run delivery:verify -- <project-folder> <job-id>");
  process.exitCode=2;
}else{
  const result=verifyDeliveryManifest(workspace,jobId);
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=1;
}
