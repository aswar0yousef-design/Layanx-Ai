import assert from "node:assert/strict";
import {isIpAddress,parsePairingLink} from "../mobile/src/pairing.js";
import {pairingLink} from "../src/local/setup-routes.js";

// What the setup page puts in the QR code is what the phone reads back.
const pin="x7Q0n2bq8VZt3s1Yw4u9rL6eK5aF2gH8jM0pN3oP1iU";
const link=pairingLink({code:"ABCD-2345",urls:["https://192.168.1.5:3000","https://100.101.102.103:3000","https://pc.tail1.ts.net"],pin,computer:"RYZEN كمبيوتر"});
assert.deepEqual(parsePairingLink(link),{code:"ABCD2345",pin,computer:"RYZEN كمبيوتر",urls:["https://192.168.1.5:3000","https://100.101.102.103:3000","https://pc.tail1.ts.net"]});

// Anything else is refused without throwing (the scanner calls this on every code it sees).
for(const bad of ["https://example.com","layanx://pair?v=2&c=ABCD2345&u=https%3A%2F%2Fa:1","layanx://pair?v=1&c=SHORT&u=https%3A%2F%2Fa:1",
  "layanx://pair?v=1&c=ABCD2345","layanx://pair?v=1&c=ABCD2345&u=http%3A%2F%2F192.168.1.5%3A3000","layanx://pair?v=1&c=ABCD2345&p=short&u=https%3A%2F%2Fa:1",
  "layanx://pair?%E0=1&v=1","layanx://pair?v=1&c=%E0%A4%A&u=x",""])
  assert.equal(parsePairingLink(bad),null,bad);
// plain http addresses never get in, even next to good ones
assert.deepEqual(parsePairingLink("layanx://pair?v=1&c=abcd2345&u=http%3A%2F%2F10.0.0.2%3A3000&u=https%3A%2F%2F10.0.0.2%3A3000")?.urls,["https://10.0.0.2:3000"]);

// IP addresses need the pinned certificate; names use their real ones.
assert.equal(isIpAddress("https://192.168.1.5:3000"),true);
assert.equal(isIpAddress("https://[fd7a:115c:a1e0::1]:3000"),true);
assert.equal(isIpAddress("https://pc.tail1.ts.net"),false);
console.log("mobile-pairing: the QR link round-trips, malformed codes are refused quietly, http never accepted");
