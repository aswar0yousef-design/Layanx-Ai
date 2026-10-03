import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  localBinanceSecretStorePath,
  saveLocalBinanceCredentials,
} from "./local-secret-store.js";

async function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Interactive secret setup requires a local terminal (TTY).");
  }
  stdout.write(prompt);
  stdin.setRawMode?.(true);
  let value = "";
  try {
    for await (const chunk of stdin) {
      const input = String(chunk);
      for (const char of input) {
        if (char === "\r" || char === "\n") {
          stdout.write("\n");
          return value;
        }
        if (char === "\u0003") throw new Error("Secret setup cancelled.");
        if (char === "\u007f") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        stdout.write("*");
      }
    }
    return value;
  } finally {
    stdin.setRawMode?.(false);
  }
}

export async function configureBinanceSecretsInteractive(): Promise<void> {
  const apiKey = await readHidden("Binance API key: ");
  const apiSecret = await readHidden("Binance API secret: ");
  await saveLocalBinanceCredentials({ apiKey, apiSecret });
  console.log(`Saved locally outside the repository: ${localBinanceSecretStorePath()}`);
  console.log("Secret values were not displayed or returned.");
}

export async function printLocalSecretStoreStatus(): Promise<void> {
  console.log(JSON.stringify({
    configuredPath: localBinanceSecretStorePath(),
    location: "local-user-home",
    repositorySafe: true,
    valuesExposed: false,
  }, null, 2));
}
