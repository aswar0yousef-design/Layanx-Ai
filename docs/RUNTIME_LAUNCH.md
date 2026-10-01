# Runtime launch checklist

1. Build the container from `Dockerfile`.
2. Supply runtime configuration through the hosting secret store.
3. Use managed PostgreSQL through `LAYANX_DATABASE_URL`.
4. Keep `LAYANX_API_TOKEN` configured before exposing the API.
5. Start the service on port 3000.
6. Require HTTP 200 from `/v1/health` before routing traffic.
7. Verify persistence health and provider health after startup.
8. Keep PostgreSQL private and expose only the authenticated API.
9. Keep the previous container image available for rollback.
