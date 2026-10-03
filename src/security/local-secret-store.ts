import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface LocalBinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

const STORE_DIR = join(homedir(), ".layanx", "secrets");
const STORE_FILE = join(STORE_DIR, "binance.json");

function assertSecret(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} cannot be empty.`);
  if (/\r|\n/.test(normalized)) throw new Error(`${name} cannot contain line breaks.`);
  return normalized;
}

/**
 * Local-only secret storage.
 *
 * The file is outside the repository and is created with owner-only permissions.
 * The trading agent never receives the raw values from this module; callers
 * should pass them directly into the exchange client and never include them in
 * logs, audit events, prompts, or tool results.
 */
export async function saveLocalBinanceCredentials(credentials: LocalBinanceCredentials): Promise<void> {
  const apiKey = assertSecret(credentials.apiKey, "Binance API key");
  const apiSecret = assertSecret(credentials.apiSecret, "Binance API secret");
  await mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  await chmod(STORE_DIR, 0o700);
  await writeFile(
    STORE_FILE,
    JSON.stringify({ apiKey, apiSecret }, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(STORE_FILE, 0o600);
}

export async function loadLocalBinanceCredentials(): Promise<LocalBinanceCredentials | null> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalBinanceCredentials>;
    if (typeof parsed.apiKey !== "string" || typeof parsed.apiSecret !== "string") {
      throw new Error("Local Binance secret store is malformed.");
    }
    return {
      apiKey: assertSecret(parsed.apiKey, "Stored Binance API key"),
      apiSecret: assertSecret(parsed.apiSecret, "Stored Binance API secret"),
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function getBinanceCredentials(): Promise<LocalBinanceCredentials> {
  const local = await loadLocalBinanceCredentials();
  if (local) return local;

  // Environment fallback is intended for CI/deployment, never for writing secrets
  // into the repository. Local desktop use should prefer the local secret store.
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (apiKey && apiSecret) return { apiKey, apiSecret };

  throw new Error(
    "Binance credentials are not configured. Use the local LayanX secret store or deployment environment variables.",
  );
}

export function localBinanceSecretStorePath(): string {
  return STORE_FILE;
}

export function localSecretStorePlatform(): string {
  return platform();
}
