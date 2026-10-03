import process from "node:process";

const required=["LAYANX_API_TOKEN","LAYANX_DATABASE_URL"] as const;
const optionalProviderSecrets=["OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY"];

function fail(message:string):never{console.error(`PRODUCTION PREFLIGHT FAILED: ${message}`);process.exit(1);}

if(process.env.NODE_ENV!=="production")fail("NODE_ENV must be production.");
for(const name of required){
 if(!process.env[name]?.trim())fail(`${name} is required.`);
}
if(!/^postgres(?:ql)?:\\/\\//i.test(process.env.LAYANX_DATABASE_URL??""))fail("LAYANX_DATABASE_URL must be a PostgreSQL connection URL.");
if(process.env.LAYANX_API_HOST!=="0.0.0.0")console.warn("WARNING: LAYANX_API_HOST is not 0.0.0.0; use a reverse proxy or container binding appropriate to the platform.");

const cloudEnabled=process.env.LAYANX_AI_MODE==="cloud"||process.env.LAYANX_AI_MODE==="hybrid";
if(cloudEnabled&&!optionalProviderSecrets.some(name=>Boolean(process.env[name]?.trim())))fail("Cloud/hybrid mode requires at least one configured cloud provider key.");
if(process.env.LAYANX_AI_MODE==="local"&&process.env.OLLAMA_ENABLED==="true"&&!process.env.OLLAMA_BASE_URL)fail("OLLAMA_BASE_URL is required when local Ollama is explicitly enabled.");
const liveTradingEnabled=process.env.BINANCE_LIVE_TRADING_ENABLED==="true";
if(liveTradingEnabled){
 if(!process.env.BINANCE_MAX_ORDER_NOTIONAL||!Number.isFinite(Number(process.env.BINANCE_MAX_ORDER_NOTIONAL))||Number(process.env.BINANCE_MAX_ORDER_NOTIONAL)<=0)fail("BINANCE_MAX_ORDER_NOTIONAL must be a positive limit when Binance live execution is enabled.");
 if(!process.env.LAYANX_SECRET_VAULT_KEY?.trim()&&(!process.env.BINANCE_API_KEY?.trim()||!process.env.BINANCE_API_SECRET?.trim()))fail("Binance live execution requires the encrypted local vault key or explicit deployment credentials.");
 if((process.env.BINANCE_BASE_URL??"https://api.binance.com")!=="https://api.binance.com")fail("Production Binance execution must use https://api.binance.com.");
}

console.log("Production preflight passed.");
console.log(JSON.stringify({
 node:process.version,
 mode:process.env.LAYANX_AI_MODE??"local",
 databaseConfigured:true,
 apiTokenConfigured:true,
 cloudProviderConfigured:optionalProviderSecrets.some(name=>Boolean(process.env[name]?.trim())),
 liveTradingEnabled
}));
