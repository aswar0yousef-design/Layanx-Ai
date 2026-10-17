import {execFileSync} from "node:child_process";
import {resolve} from "node:path";

execFileSync(process.execPath,["--check",resolve(process.cwd(),"web","app.js")],{stdio:"pipe"});
console.log("Browser application JavaScript syntax: ok");
