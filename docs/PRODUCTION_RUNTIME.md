# LayanX Production Runtime

Portable Docker Compose deployment for a VPS or Docker-compatible cloud host.

## Required secrets

Set these through the host secret manager; never commit them:

- `LAYANX_API_TOKEN`
- `LAYANX_DATABASE_URL`
- `LAYANX_AI_MODE` (`local`, `cloud`, or `hybrid`)
- provider credentials required by the selected mode

## Preflight

```bash
npm install
npm run production:preflight
```

## Start

```bash
docker compose -f docker-compose.production.yml up -d --build
```

## Verify

```bash
curl -i http://127.0.0.1:3000/v1/health
curl -i http://127.0.0.1:3000/v1/status
```

Then point `LAYANX_PRODUCTION_URL` at the real deployed instance and run:

```bash
npm run production:acceptance
```

## PostgreSQL

Use managed or private PostgreSQL. Do not expose the database publicly. Confirm that runtime health reports writable persistence.

## Public routing

Terminate TLS at the hosting platform or reverse proxy and keep the application container private where possible.

## Rollback

Keep the previous immutable container image. If health or acceptance fails, restore the previous image/tag, restart the service, and repeat the health and acceptance checks.

## Production acceptance gate

Production is not accepted until the container starts, `/v1/health` and `/v1/status` return HTTP 200, PostgreSQL persistence is healthy and writable, the configured provider is healthy, `npm run production:acceptance` passes, and the rollback path has been verified.
