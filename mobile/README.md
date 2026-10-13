# LayanX Remote (Android)

The phone side of LayanX: follow and approve what your computer's agent does, from anywhere on
your home network or over Tailscale. No cloud server is involved.

- **Secure pairing by QR code.** The setup page on the PC shows a QR code with the pairing code,
  the PC's addresses and the SHA-256 fingerprint of its own TLS certificate. The app accepts only
  that certificate on IP addresses, so nobody else on the Wi-Fi can read or answer its requests.
  Plain `http://` is never used. Tailscale names (`https://…ts.net`) use their real certificates.
- **Approvals with your fingerprint, even when the app is closed.** A foreground service follows
  the PC (`/v1/companion/feed`, one long-poll request at a time). Every waiting approval becomes a
  notification with Approve / Reject. Each button opens the fingerprint prompt (or the screen
  lock), and the decision carries the request's digest. LayanX applies it to exactly that request
  and continues the work on the PC by itself.
- **Ongoing mission notification:** the goal, the stage and the progress, then the result, with
  "Open the site on the computer".
- **Quick Settings tile "Ask LayanX"** (voice; questions and reports, no tasks), and a **home-screen
  widget** with the PC's CPU/RAM, the running mission, waiting approvals and the MT5 auto-scalper.

The Android parts live in `modules/layanx-native` (Kotlin, an Expo local module): pinned HTTPS
(`LxHttp`), Keystore-encrypted settings (`LxConfig`), `WatchService`, `ApprovalActivity`,
`AskTileService` + `VoiceAskActivity`, `StatusWidget`, `ActionReceiver` and `BootReceiver`.
iOS and Expo Go run the same JavaScript without them; there plain `fetch` reaches `*.ts.net` only.

## Get the APK

GitHub → Actions → **LayanX Mobile CI** → the latest green run → Artifacts → `LayanX-Remote-apk`.
See [BUILD.md](BUILD.md) to build it yourself.

## Development

```bash
cd mobile
npm install
npm run typecheck
npx expo export --platform android     # JavaScript bundle check
npx expo prebuild --platform android --no-install && (cd android && ./gradlew assembleRelease)
```
