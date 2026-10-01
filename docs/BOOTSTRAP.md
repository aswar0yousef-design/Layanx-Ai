# LayanX Bootstrap

## Purpose

The bootstrap script prepares a fresh checkout without changing an existing .env file.

## Run

From the repository root:

```bash
node scripts/bootstrap.mjs
```

On Unix systems it can also be run directly after checkout:

```bash
chmod +x scripts/bootstrap.mjs
./scripts/bootstrap.mjs
```

The bootstrap:

1. Requires Node.js 22+.
2. Creates .env from .env.example only when .env does not already exist.
3. Installs npm dependencies unless `--skip-install` is supplied.
4. Builds the TypeScript runtime.
5. Runs the LayanX configuration check.
6. Runs the provider doctor and reports local-provider warnings without failing bootstrap.

It does **not** download Ollama or pull models by default. To explicitly pull the configured Ollama model after installing Ollama, use `node scripts/bootstrap.mjs --pull-ollama-model`. Existing credentials are never overwritten.

After bootstrap:

```bash
npm run layanx -- health
```

For a real local Ollama verification:

```bash
npm run smoke:ollama
```
