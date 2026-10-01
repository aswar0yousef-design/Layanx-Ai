import {LayanXCore} from "../src/core/orchestrator.js";
import {BackupManager} from "../src/core/backup-manager.js";
import {ReleaseGate} from "../src/release/release-gate.js";
import {createReleaseManifest} from "../src/release/release-manifest.js";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const dir=await mkdtemp(join(tmpdir(),"layanx-release-"));
const source=join(dir,"runtime.json");
const backup=join(dir,"backup.json");
const original='{"status":"stable","version":"1"}';
const updated='{"status":"candidate","version":"2"}';
await writeFile(source,original);

const backups=new BackupManager();
const record=await backups.backup(source,backup);
if(!(await backups.verify(record)))throw new Error("Fresh backup failed integrity verification.");

await writeFile(source,updated);
await backups.restore(record);
if((await readFile(source,"utf8"))!==original)throw new Error("Integrity-checked rollback did not restore the original state.");

await writeFile(backup,'tampered');
let tamperBlocked=false;
try{await backups.restore(record);}catch{tamperBlocked=true;}
if(!tamperBlocked)throw new Error("Tampered backup was restored.");

const manifest=createReleaseManifest({version:"1.0.0",commitSha:"abcdef1234567",artifacts:["runtime.json"]});
const gate=new ReleaseGate();
const allowed=gate.evaluate({security:true,typecheck:true,tests:true,redTeam:true,configuration:true,recovery:true,version:manifest.version,commitSha:manifest.commitSha,checksum:manifest.checksum});
if(!allowed.allowed)throw new Error("Complete release evidence was rejected.");
const blocked=gate.evaluate({...{security:true,typecheck:true,tests:true,redTeam:true,configuration:true,recovery:true},version:manifest.version,commitSha:manifest.commitSha,checksum:"bad"});
if(blocked.allowed)throw new Error("Malformed release checksum was accepted.");

const core=new LayanXCore();
const snapshot=JSON.stringify({memory:core.memory.list(),audit:core.audit.forMission("none")});
if(/authorization|bearer|api[_-]?key|password|secret/i.test(snapshot))throw new Error("Runtime baseline contains credential-like material.");

await rm(dir,{recursive:true,force:true});
console.log("Release, backup integrity, rollback and snapshot safety test passed.");
