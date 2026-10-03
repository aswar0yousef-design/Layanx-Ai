import {strict as assert} from "node:assert";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {getDeviceId,deviceIdentity} from "../src/device-identity.js";

const root=await mkdtemp(join(tmpdir(),"layanx-device-"));
process.env.LAYANX_DATA_DIR=root;
delete process.env.LAYANX_DEVICE_ID;
const id1=await getDeviceId();
const id2=await getDeviceId();
assert.match(id1,/^LYX-[A-F0-9]{16}$/);
assert.equal(id1,id2);
assert.equal((await readFile(join(root,"device-id"),"utf8")).trim(),id1);
const identity=await deviceIdentity();
assert.equal(identity.deviceId,id1);
assert.equal(identity.apiVersion,"v1");
await rm(root,{recursive:true,force:true});
console.log("device identity tests passed");
