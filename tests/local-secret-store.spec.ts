import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

const tempHome = await mkdtemp(join(tmpdir(), "layanx-secret-test-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

try {
  const mod = await import("../src/security/local-secret-store.js");
  await mod.saveLocalBinanceCredentials({ apiKey: "k", apiSecret: "s" });

  const loaded = await mod.loadLocalBinanceCredentials();
  assert.deepEqual(loaded, { apiKey: "k", apiSecret: "s" });

  const path = mod.localBinanceSecretStorePath();
  assert.equal(path.startsWith(tempHome), true);
  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("k"), true);
  assert.equal(raw.includes("s"), true);

  console.log("local-secret-store: ok");
} finally {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tempHome, { recursive: true, force: true });
}
