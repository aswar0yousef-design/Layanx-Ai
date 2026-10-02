import {strict as assert} from "node:assert";
const route=/^\/v1\/control-center\/session(?:\?.*)?$/;
assert.equal(route.test("/v1/control-center/session?projectId=p"),true);
assert.equal(route.test("/v1/control-center/session?projectId=p&missionId=m"),true);
assert.equal(route.test("/v1/control-center/session"),true);
console.log("Remote control route contract passed.");
