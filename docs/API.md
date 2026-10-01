# LayanX Runtime API

Start the local runtime API with:

```bash
npm run api
```

Default bind: `127.0.0.1:3000`.

Endpoints:
- `GET /v1/status` — runtime configuration and registered models.
- `GET /v1/health` — live provider health.
- `POST /v1/missions` — AI-plan and start a mission. Body: `{ "goal": "..." }`.

The mission endpoint is protected by `LAYANX_API_TOKEN` when configured. The API binds to loopback by default. Do not expose it publicly without authentication and an appropriate network policy.
