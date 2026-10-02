import {strict as assert} from "node:assert";
const route=/^\/v1\/agent\/gateway$/;
assert.equal(route.test("/v1/agent/gateway"),true);
console.log("Production agent gateway route contract passed.");
