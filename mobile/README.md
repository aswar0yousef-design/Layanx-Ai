# LayanX Remote

Android/iOS remote control client for the LayanX API.

## Development

```bash
cd mobile
npm install
npx expo start
```

## Android APK

Install Expo EAS CLI and authenticate with an Expo account:

```bash
cd mobile
npx eas login
npx eas build --platform android --profile preview
```

The `preview` profile is configured to produce an installable APK. The API must be reachable from the phone; use HTTPS for remote access.

## Security

- Bearer tokens are stored with Expo SecureStore.
- No production token is committed to Git.
- Project and mission IDs are stored locally.
- The app does not embed a server secret.
