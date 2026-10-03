import {runOperationalAcceptance} from "../src/operational-acceptance.js";

const result=await runOperationalAcceptance(undefined,{
  requireLiveProviders:process.env.LAYANX_OPERATIONAL_REQUIRE_LIVE_PROVIDERS==="true"
});

console.log(JSON.stringify({
  accepted:result.accepted,
  strict:result.strict,
  reviewedTwice:result.reviewedTwice,
  checks:result.checks,
  providers:result.providerHealth.providers,
  timestamp:result.timestamp
},null,2));

if(!result.accepted)process.exitCode=1;
