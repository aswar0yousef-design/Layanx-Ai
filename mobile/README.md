# LayanX Remote (Android)

The phone companion for LayanX. It reaches the owner's own PC only through the encrypted phone link.

- **Encrypted link.**
  - Pair once by scanning the QR code from the PC's setup page.
  - The PC's public key comes from the QR code, so another device on the network cannot pose as the PC.
  - Requests use P-256 ECDH, then HKDF-SHA256, then AES-256-GCM.
  - The PC accepts each request once, and only within ±5 minutes of its timestamp.
  - Keys are stored encrypted under an Android Keystore key and never reach JavaScript.
  - Server side: `src/security/phone-link.ts` and `src/security/link-routes.ts`.
- **One approval list.**
  - It shows LayanX approvals and Claude Code / Codex permission prompts (from the PC's `/v1/companion/feed`).
  - Approve only after fingerprint, face or screen-lock PIN. Deny takes one tap.
  - Each decision quotes the digest of what was shown (`/v1/companion/decide`).
- **Live updates (opt-in).**
  - A foreground service long-polls the feed.
  - An ongoing notification shows the running job, its stage and progress, or the coding agent at work, plus the PC load. On Android 16 it is a promoted "live update".
  - Each approval gets its own notification with Approve and Deny buttons, usable from the lock screen.
  - A notice appears when a job or agent finishes.
- **Quick settings tile** "اسأل LayanX" and a **home-screen widget**.
- **Voice question.** Records a 16 kHz WAV, sends it over the encrypted link to `/v1/voice/transcribe`, and shows the text to review before anything runs.

## Layout

| Path | What |
|---|---|
| `App.tsx` | Screens: home, jobs/approvals, apps, settings (pairing by QR) |
| `src/api.ts` | Typed calls; every request goes through the native link |
| `modules/layanx-native/` | Local Expo module (Android): `LinkCrypto`, `LinkClient`, `MiniJson` (plain JDK, tested on the PC against the Node code in `tests/phone-link.spec.ts`), `DeviceStore`, `CompanionService`, `Notify`, `ApproveActivity`, `DecisionReceiver`, `AskTileService`, `StatusWidget`, `BootReceiver`, `VoiceRecorder`, `LayanxNativeModule.kt` |
| `plugins/with-layanx-android.js` | Allows plain HTTP to the PC's LAN address. That traffic is already end-to-end encrypted at the app layer. |

## Build

CI (`.github/workflows/mobile.yml`) typechecks, bundles, and builds `LayanX-Remote.apk` as a workflow artifact. It is signed with the Expo template's standard debug key, so each new APK installs over the previous one.

Locally (Node 22, JDK 17, Android SDK):

```bash
cd mobile
npm install
npm run typecheck
npm run build:apk   # android/app/build/outputs/apk/release/app-release.apk
```

See `BUILD.md` for details. The app is Android-only: the encrypted link, notifications and fingerprint check are native Android code.
