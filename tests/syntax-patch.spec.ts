import assert from "node:assert/strict";
import {applySyntaxPatch,buildSyntaxPatchPrompt,locateSyntaxError} from "../src/autonomy/js-source-repair.js";

// The shape that stopped a live run: a whole file on one line with one stray brace.
const oneLine="import http from 'node:http';const a=1;function f(){return a;}};const b=2;export {f,b};";
const located=locateSyntaxError(oneLine)!;
assert.match(located.message,/SyntaxError/);
assert.match(located.excerpt,/return a;}}?<<<PARSER STOPS HERE>>>/,"the column is marked, not just line 1");
assert.equal(locateSyntaxError("export const ok=1;\n"),undefined);
const multi="const a=1;\nfunction f( {\n  return 1;\n}\n";
assert.match(locateSyntaxError(multi)!.excerpt,/PARSER STOPS HERE/);
assert.ok(buildSyntaxPatchPrompt(oneLine,located).includes(oneLine));

assert.equal(applySyntaxPatch(oneLine,{edits:[{find:"return a;}};",replace:"return a;};"}]}),oneLine.replace("return a;}};","return a;};"));
assert.throws(()=>applySyntaxPatch(oneLine,null),/no edits/);
assert.throws(()=>applySyntaxPatch(oneLine,{edits:[]}),/no edits/);
assert.throws(()=>applySyntaxPatch(oneLine,{edits:[1,2,3,4]}),/More than 3/);
assert.throws(()=>applySyntaxPatch(oneLine,{edits:[{find:"absent",replace:"x"}]}),/occurs 0 times/);
assert.throws(()=>applySyntaxPatch(oneLine,{edits:[{find:"a",replace:"x"}]}),/exactly once/);
assert.throws(()=>applySyntaxPatch(oneLine,{edits:[{find:"const b=2;",replace:"const c=3;"}]}),/still does not parse/,"a patch is accepted only when the file then parses");
console.log("syntax-patch: parse errors are located by column and patches accepted only if the file then parses");
