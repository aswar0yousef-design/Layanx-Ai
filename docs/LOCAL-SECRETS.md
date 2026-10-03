# Local secrets

LayanX stores Binance execution credentials in the existing encrypted local secret vault. No Binance API secret is stored in GitHub or in `.env.example`.

## 1. Configure the local vault master key

Set `LAYANX_SECRET_VAULT_KEY` in the local machine environment. It must be at least 16 characters and must never be committed to Git.

## 2. Store the Binance credentials

Use the LayanX CLI, which reads secret values from stdin and never echoes them:

```bash
npm run layanx -- secrets set binance.apiKey
npm run layanx -- secrets set binance.apiSecret
```

Verify only the names, never the values:

```bash
npm run layanx -- secrets list
```

The encrypted vault defaults to:

```text
~/.layanx/secrets.vault
```

and the default vault is outside the repository, so it cannot be committed accidentally. A custom `LAYANX_SECRET_VAULT_PATH` may still be used when needed. The vault uses AES-256-GCM with a key derived from the local master key. The stored file does not contain plaintext secret values.

## Runtime behavior

- Binance public market-data access does not need credentials.
- Binance execution loads `binance.apiKey` and `binance.apiSecret` from the encrypted local vault first.
- Environment variables `BINANCE_API_KEY` and `BINANCE_API_SECRET` remain a deployment/CI fallback only.
- Secret values must never be placed in prompts, tool results, audit events, logs, commits, or GitHub issues.
- Production execution remains disabled unless `BINANCE_LIVE_TRADING_ENABLED=true`, a positive `BINANCE_MAX_ORDER_NOTIONAL` is configured, credentials exist, and the LayanX L4 approval path authorizes the exact order payload.

## Important

The master key is the root secret for this vault. Keep it outside the repository and back it up securely. Do not put the master key into `.env.example`.
