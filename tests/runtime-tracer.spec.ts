import {RuntimeTracer} from "../src/core/runtime-tracer.js";

const tracer=new RuntimeTracer();
const root=tracer.start("mission","mission",{missionId:"m1",token:"Bearer super-secret-token"});
const child=tracer.start("tool","tool",{tool:"files",parent:"ok"},root.traceId,root.spanId);
tracer.end(child,"success",{durationSource:"runtime"});
tracer.end(root,"success");
const spans=tracer.get(root.traceId);
if(spans.length!==2)throw new Error("Expected correlated root and child spans.");
if(spans[0].attributes.token!=="[REDACTED]")throw new Error("Sensitive trace attributes were not sanitized.");
if(spans[1].parentSpanId!==root.spanId)throw new Error("Parent span correlation failed.");
if(!spans.every(span=>span.endedAt&&typeof span.durationMs==="number"))throw new Error("Span completion metadata missing.");
console.log("Runtime tracer tests passed.");
