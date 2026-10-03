import assert from "node:assert/strict";
import {createYahooMailAdapter} from "../src/connectors/yahoo-mail.js";
process.env.YAHOO_EMAIL="test@example.com";
process.env.YAHOO_APP_PASSWORD="placeholder";
const adapter=createYahooMailAdapter();
await assert.rejects(
  () => adapter.execute({tool:"yahoo.mail",action:"unsupported action",payload:{},missionId:"m",agentId:"a",permission:"L1_READ",idempotencyKey:"k"} as any),
  /Unsupported Yahoo Mail action/
);
console.log("yahoo-mail.spec.ts passed");
