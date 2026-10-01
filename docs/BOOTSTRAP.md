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

It does **not** download Ollama, pull models, or overwrite credentials. Provider installation remains an explicit user action.

After bootstrap:

```bash
npm run layanx -- health
```

For a real local Ollama verification:

```bash
npm run smoke:ollama
```
