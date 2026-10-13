# Build LayanX Remote APK

## From GitHub (no tools needed)

Each push to `main` builds the app and puts it on the **android-latest** pre-release. On the phone, open:

`https://github.com/aswar0yousef-design/layanx-ai/releases/download/android-latest/LayanX-Remote.apk`

Then allow installing from that source. Every build is also kept for 30 days as the **LayanX-Remote-apk** artifact of the run (GitHub → Actions → LayanX Mobile CI).

If an older LayanX Remote built with EAS is installed, uninstall it first. It was signed with a different key.

## Your own signing key (recommended)

Android lets an app be updated only by an APK signed with the same key. Without your own key, CI signs with the Expo template's debug key. That key is public, so anyone could build an "update" that your phone would accept if you installed it. To use your own key, do this once on any computer with a JDK (Android Studio includes one):

```bash
keytool -genkeypair -v -keystore layanx-release.jks -alias layanx -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 layanx-release.jks > layanx-release.b64
```

On Windows (PowerShell), make the base64 file with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("layanx-release.jks")) | Set-Content layanx-release.b64
```

Then, in GitHub → Settings → Secrets and variables → Actions, add four secrets:

- `ANDROID_KEYSTORE_BASE64`: the content of `layanx-release.b64`.
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `ANDROID_KEY_ALIAS`: `layanx`.
- `ANDROID_KEY_PASSWORD`: the key password.

Keep `layanx-release.jks` and its passwords somewhere safe; if they are lost, the app cannot be updated without reinstalling it. Switching keys also needs one uninstall and reinstall, which removes the phone's pairing, so pair again afterwards.

## On your computer

You need Node.js 22, JDK 17, and the Android SDK (Android Studio installs it; set `ANDROID_HOME`).

```bash
cd mobile
npm install
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK is at `android/app/build/outputs/apk/release/app-release.apk`. To run on a connected phone for development, use `npx expo run:android`. Expo Go does not work, because the app has native code.

EAS still works too (`npx eas build --platform android --profile preview`, see `eas.json`). An APK from EAS is signed with your EAS key, so it does not install over a CI build. Pick one source.

## Connect to LayanX

1. On the PC, open the setup page and turn on **السماح للهاتف بالاتصال عبر شبكة Wi-Fi نفسها**.
2. Select **إنشاء رمز ربط**.
3. In the app, go to الإعدادات → **ربط بمسح الرمز** and scan the code.

The QR code carries every address of the PC (home Wi-Fi, and Tailscale when "control from anywhere" is on). The app tries them in order.

Do not expose LayanX directly to the internet. To reach it away from home, use Tailscale (see `docs/دليل-التشغيل.md`).
