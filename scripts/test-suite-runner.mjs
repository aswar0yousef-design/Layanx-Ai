import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testsRoot = join(root, "tests");
const timeoutMs = Math.min(Math.max(Number(process.env.LAYANX_TEST_TIMEOUT_MS ?? 120000), 1000), 600000);

async function discover(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await discover(full));
    } else if (/\.(spec|test)\.(c|m)?tsx?$|\.(spec|test)\.(c|m)?js$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function runTest(file) {
  const tsxEntry = resolve(root, "node_modules/tsx/dist/cli.mjs");
  const rel = relative(root, file);
  return new Promise((resolveResult) => {
    const started = Date.now();
    const child = spawn(process.execPath, [tsxEntry, rel], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, chunk) => (current + String(chunk)).slice(-65536);
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.on("error", error => {
      clearTimeout(timer);
      resolveResult({ ok: false, timedOut, code: null, stdout, stderr: error.stack ?? error.message, durationMs: Date.now() - started });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({ ok: !timedOut && code === 0, timedOut, code, signal, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

const files = (await discover(testsRoot)).sort((a, b) => a.localeCompare(b));
if (!files.length) {
  console.error("No test files were discovered under tests/.");
  process.exit(1);
}

console.log(`LayanX test suite: discovered ${files.length} test files.`);
const failed = [];
let passed = 0;
const started = Date.now();

for (let index = 0; index < files.length; index++) {
  const file = files[index];
  const rel = relative(root, file);
  process.stdout.write(`[${index + 1}/${files.length}] ${rel} ... `);
  const result = await runTest(file);
  if (result.ok) {
    passed++;
    console.log(`PASS (${result.durationMs}ms)`);
  } else {
    failed.push({ rel, ...result });
    console.log(result.timedOut ? `TIMEOUT (${result.durationMs}ms)` : `FAIL (exit=${result.code ?? "error"}, ${result.durationMs}ms)`);
  }
}

console.log("");
console.log(`Test files: ${files.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed.length}`);
console.log(`Duration: ${Date.now() - started}ms`);

if (failed.length) {
  console.error("");
  console.error("Failed test files:");
  for (const failure of failed) {
    console.error(`- ${failure.rel}`);
    if (failure.stderr.trim()) console.error(failure.stderr.trim());
    else if (failure.stdout.trim()) console.error(failure.stdout.trim());
  }
  process.exit(1);
}

console.log("All discovered test files passed.");
