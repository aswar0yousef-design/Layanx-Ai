# Local secrets

LayanX keeps Binance execution credentials outside the Git repository.

## Setup

Run this on the user's own computer from the repository:

```bash
npm run layanx -- secrets:setup-binance
```

The command prompts for the API key and secret without displaying their values. The credentials are stored at:

```text
~/.layanx/secrets/binance.json
```

The directory is created with owner-only permissions (0700) and the file with owner-only permissions (0600). The file is outside the repository, so it is not committed to GitHub.

Check only the configured location:

```bash
npm run layanx -- secrets:status
```

## Runtime behavior

- Binance public market-data access does not need API credentials.
- Binance execution loads credentials from the local store first.
- Environment variables may be used as a deployment/CI fallback, but they are not written by LayanX.
- Secret values must never be placed in prompts, tool payloads, audit events, logs, commits, or GitHub issues.
- Production execution remains disabled unless `BINANCE_LIVE_TRADING_ENABLED=true`, an order-notional limit is configured, and the LayanX runtime approval path authorizes the execution.

## Important security note

The current local provider is an owner-permissioned local file, not an OS keychain/TPM-backed vault. It prevents accidental repository exposure and limits normal local file access, but it is not equivalent to hardware-backed or OS-encrypted secret storage. A future OS-keychain provider can implement the same `LocalBinanceCredentials` interface without changing the trading layer.
