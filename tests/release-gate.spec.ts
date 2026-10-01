import {ReleaseGate} from "../src/release/release-gate.js";
import {createReleaseManifest} from "../src/release/release-manifest.js";
const gate=new ReleaseGate();
const blocked=gate.evaluate({typecheck:true,tests:true,redTeam:false,configuration:true,recovery:true,version:"0.1.0",commitSha:"abc",checksum:"xyz"});
if(blocked.allowed)throw new Error("Failed release was allowed.");
const manifest=createReleaseManifest({version:"0.1.0",commitSha:"abc",artifacts:["dist/"]});
if(!manifest.checksum||manifest.checksum.length!==64)throw new Error("Release checksum missing.");
console.log("Release gate test passed.");
