import {ReleaseGate} from "../src/release/release-gate.js";
import {createReleaseManifest} from "../src/release/release-manifest.js";

const gate=new ReleaseGate();
const blocked=gate.evaluate({
 security:true,
 typecheck:true,
 tests:true,
 redTeam:false,
 configuration:true,
 recovery:true,
 version:"0.1.0",
 commitSha:"abc1234",
 checksum:"a".repeat(64)
});
if(blocked.allowed)throw new Error("Failed release was allowed.");

const insecure=gate.evaluate({
 security:false,
 typecheck:true,
 tests:true,
 redTeam:true,
 configuration:true,
 recovery:true,
 version:"0.1.0",
 commitSha:"abc1234",
 checksum:"a".repeat(64)
});
if(insecure.allowed||!insecure.reasons.includes("security gate failed."))throw new Error("Security gate failure was not enforced.");

const invalid=gate.evaluate({
 security:true,
 typecheck:true,
 tests:true,
 redTeam:true,
 configuration:true,
 recovery:true,
 version:"0.1.0",
 commitSha:"not-a-sha",
 checksum:"xyz"
});
if(invalid.allowed||invalid.reasons.length<2)throw new Error("Invalid release evidence was accepted.");

const manifest=createReleaseManifest({version:"0.1.0",commitSha:"abc1234",artifacts:["dist/"]});
if(!manifest.checksum||manifest.checksum.length!==64)throw new Error("Release checksum missing.");

console.log("Release gate test passed.");
