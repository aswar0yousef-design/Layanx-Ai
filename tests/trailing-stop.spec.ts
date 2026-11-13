import assert from "node:assert/strict";
import {trailingStop} from "../src/trading/trailing-stop.js";

// Gold long at 2400, first stop 2394 (R = 6), ATR 4.
const base={side:"long" as const,entry:2400,initialStop:2394,stopLoss:2394,atr:4};
assert.equal(trailingStop({...base,bid:2404,ask:2404.2}),null,"below 1R: the stop stays");
const be=trailingStop({...base,bid:2406.5,ask:2406.7})!;
assert.equal(be.stage,"breakeven");assert.ok(Math.abs(be.stop-2400.2)<1e-9,"to the entry plus the spread");
const trail=trailingStop({...base,stopLoss:2400.2,bid:2415,ask:2415.2})!;
assert.equal(trail.stage,"trail");assert.equal(trail.stop,2409,"1.5 ATR behind the price");assert.equal(trail.lockedR,1.5);
// The price falls back: the stop never moves back.
assert.equal(trailingStop({...base,stopLoss:2409,bid:2410,ask:2410.2}),null);
// A tiny gain over the current stop is skipped.
assert.equal(trailingStop({...base,stopLoss:2409,bid:2415.3,ask:2415.5}),null);
// Never closer than the broker's minimum distance.
const near=trailingStop({...base,bid:2415,ask:2415.2,minDistance:8})!;
assert.equal(near.stop,2407);
// Short mirror: entry 2400, stop 2406, price falls to 2385.
const short=trailingStop({side:"short",entry:2400,initialStop:2406,stopLoss:2406,atr:4,bid:2384.8,ask:2385})!;
assert.equal(short.stop,2391);assert.equal(short.stage,"trail");
assert.equal(trailingStop({side:"short",entry:2400,initialStop:2406,stopLoss:2391,atr:4,bid:2389,ask:2389.2}),null,"short stop never moves up");
// The first stop is unknown after a restart: a stop still on the losing side defines R; a locked stop with no record is left alone.
assert.ok(trailingStop({side:"long",entry:2400,stopLoss:2394,atr:4,bid:2407,ask:2407.2}));
assert.equal(trailingStop({side:"long",entry:2400,stopLoss:2402,atr:4,bid:2420,ask:2420.2}),null);
// Bad input changes nothing.
assert.equal(trailingStop({...base,atr:0,bid:2420,ask:2420.2}),null);
console.log("trailing-stop: breakeven at 1R, trails at 1.5 ATR, never moves back, respects the broker's distance");
