# LayanX Remote

Android/iOS remote control client for the LayanX API.

## CI validation

The repository validates the mobile project with:

```bash
cd mobile
npm install
npm run typecheck
npm run export:android
```

## Development

```bash
cd mobile
npm install
npx expo start
```

## Android APK

Authenticate with an Expo/EAS account:

```bash
cd mobile
npx eas login
npx eas build --platform android --profile preview
```

The `preview` profile produces an installable APK.

## Connect LayanX

On first launch enter:

- **API URL**: the reachable HTTPS address of the LayanX API
- **Bearer token**: the API authentication token
- **Project ID**
- **Mission ID** when monitoring a specific mission

The token is stored using Expo SecureStore and is not committed to Git.

For same-LAN testing, the phone must reach the computer's LAN address; `localhost` on the phone refers to the phone itself. For access outside the LAN, use a secured HTTPS reverse proxy, tunnel, or private VPN.

Do not expose the LayanX control API directly to the public internet without an authenticated and secured gateway.
