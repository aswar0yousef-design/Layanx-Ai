# Build LayanX Remote APK

The mobile client is already merged into `main`.

## 1. Install Node.js

Use Node.js 22 or newer.

## 2. Install Expo/EAS

```bash
npm install
npm install -g eas-cli
```

## 3. Enter the mobile project

```bash
cd mobile
```

## 4. Authenticate EAS

```bash
eas login
```

## 5. Build an installable Android APK

```bash
eas build --platform android --profile preview
```

The `preview` profile in `mobile/eas.json` is configured with:

- Android
- internal distribution
- APK output

When the build finishes, EAS provides the APK build page/link.

## 6. Install on the phone

Open the EAS build link on the Android phone and install the APK. Android may ask permission to install an app from that source.

## 7. Connect LayanX

On first launch enter:

- **API URL**: the reachable HTTPS address of the LayanX API
- **Bearer token**: the API authentication token
- **Project ID**
- **Mission ID** when monitoring a specific mission

The token is stored using Expo SecureStore and is not committed to Git.

## Important network requirement

If the LayanX API is running only on the development PC as `localhost`, the phone cannot use `http://localhost` to reach that PC.

For testing on the same Wi-Fi, expose the API on the computer's LAN address and configure the API to listen on an appropriate interface. For remote access outside the local network, use a secured HTTPS endpoint/reverse proxy or a VPN/private network.

Do not expose an unauthenticated LayanX API directly to the public internet.
