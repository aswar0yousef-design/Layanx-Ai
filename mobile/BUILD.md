# Build the LayanX Remote APK

## On GitHub (no Expo account, nothing to install)

Every push that touches `mobile/` runs **LayanX Mobile CI**:

1. `mobile`: install, TypeScript check, JavaScript bundle (`expo export`).
2. `apk`: `expo prebuild` + `./gradlew assembleRelease` (arm64-v8a, armeabi-v7a, x86_64).
   It then signs the APK and checks its manifest: the watch service, the approval screen, the
   voice screen, the tile, the widget and their permissions must be present, and there must be
   no cleartext traffic and no microphone permission.
3. `launch`: installs the APK on an Android 14 emulator and fails on any crash at start.

Download the artifact `LayanX-Remote-apk` from the run and install `LayanX-Remote.apk` on the phone.

### Signing

Without secrets, the APK is signed with the standard React Native debug key. That key is the same
on every build, so new builds install over old ones and the pairing survives. To sign with your
own key, add two repository secrets (Settings → Secrets and variables → Actions):

- `LAYANX_ANDROID_KEYSTORE`: your keystore file in base64 (`base64 -w0 layanx.jks`), key alias `layanx`.
- `LAYANX_ANDROID_KEYSTORE_PASSWORD`: its password.

Create one with:

```bash
keytool -genkeypair -v -keystore layanx.jks -alias layanx -keyalg RSA -keysize 3072 -validity 10000
```

Moving from the debug key to your own key needs one uninstall of the old app (Android refuses an
update signed by a different key).

## Locally

Node.js 22, JDK 17 and the Android SDK:

```bash
cd mobile
npm install
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# android/app/build/outputs/apk/release/app-release.apk
```

## Pair the phone

On the PC: setup page → allow phone access → restart → **Create pairing code**. In the app:
Settings → **Pair by scanning the QR code**. Then turn on **Follow in the background** and allow
notifications and background work.
