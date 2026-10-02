# Secure Remote Phone Access

LayanX remains local-first. Remote phone access must not expose an unauthenticated API.

## Required configuration

Set a strong API token:

```bash
export LAYANX_API_TOKEN='replace-with-a-long-random-secret'
export LAYANX_API_REQUIRE_TOKEN=true
```

For a LAN-only test, bind to the computer's LAN interface:

```bash
export LAYANX_API_HOST=0.0.0.0
npm run api
```

The mobile app should use the computer's reachable LAN address, for example:

```
http://192.168.x.x:3000
```

Do not use `localhost` on the phone.

## Internet access

For access outside the home/office network, put LayanX behind a private network or an HTTPS reverse/tunnel layer. The phone should connect to the HTTPS endpoint, and the API token remains a secret stored by the app's SecureStore.

Recommended architecture:

```
Phone
  |
 HTTPS / private network
  |
Secure gateway / reverse proxy
  |
LayanX API (token required)
  |
Local LayanX runtime
```

Do not expose port 3000 directly to the public Internet.

## Health

`/v1/health` remains available for health checks. Other API routes require the configured bearer token when remote access is enabled.
