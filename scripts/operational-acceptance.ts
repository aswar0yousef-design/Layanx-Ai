import {runOperationalAcceptance} from "../src/operational-acceptance.js";

const strict=process.argv.includes("--strict")||process.env.LAYANX_OPERATIONAL_REQUIRE_LIVE_PROVIDERS==="true";
const result=await runOperationalAcceptance(undefined,{requireLiveProviders:strict});

console.log(JSON.stringify({
  accepted:result.accepted,
  strict:result.strict,
  reviewedTwice:result.reviewedTwice,
  checks:result.checks,
  providers:result.providerHealth.providers,
  timestamp:result.timestamp
},null,2));

if(!result.accepted)process.exitCode=1;
