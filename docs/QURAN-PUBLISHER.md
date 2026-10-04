# LayanX Quran Publisher

Dedicated pipeline for a Quran-focused TikTok/YouTube channel.

## Duration policy
- Minimum 30 seconds.
- Maximum 60 seconds.
- Target 45 seconds.
- Never split a verse.
- Extend with consecutive verses when needed to reach the minimum.
- Stop before exceeding the maximum.
- Reject an already-published verse range using a deterministic idempotency key.

## Pipeline
1. Verified Quran verse source.
2. Licensed recitation asset with provenance.
3. Optional translation/subtitles.
4. Vertical 9:16 MP4 renderer.
5. Verification of verses, audio duration, subtitles, and asset provenance.
6. Existing NativeSocialConnector for YouTube/TikTok publication.
7. Persistent publication IDs for idempotent retries.

## Rights
Do not redistribute a recitation merely because it is playable on a third-party website. Every recitation must have an explicit reuse/license record before publication.

## Remaining layers
- Quran source adapter.
- Reviewed timing source catalog (`LAYANX_QURAN_TIMING_SOURCE`); timing data never grants recitation rights.
- Licensed recitation catalog.
- Arabic RTL subtitle renderer.
- FFmpeg composition using CreatorEngine.
- Two-publications-per-day scheduler.
- OAuth and publication-status reconciliation.
- End-to-end tests with local fixture media.
## Production reconciliation

Platform publication is asynchronous. LayanX records each external publication ID as `submitted`, then `quran.reconcile` queries TikTok/YouTube and changes the ledger to `published`, `failed`, or `submitted`. `quran.publish_next` reconciles outstanding entries before creating another publication, and failed platform submissions can be retried without duplicating successful platforms.

## Runtime configuration

Quran Foundation credentials stay on the LayanX backend. Use `QF_ENV=prelive` for testing and `QF_ENV=production` only after production access is approved. The Content API uses Client Credentials with the `content` scope and token caching.

Required before automatic publication:
- `QF_CLIENT_ID`
- `QF_CLIENT_SECRET`
- `LAYANX_QURAN_RECITATION_ID`
- `LAYANX_QURAN_TIMING_SOURCE` (default reviewed source: `qud-universal-audio`)
- an approved recitation rights record
- YouTube and TikTok OAuth connections/tokens
- FFmpeg and FFprobe
- an Arabic-capable font (Amiri by default, or set `LAYANX_QURAN_FONT_NAME` / `LAYANX_QURAN_FONT_FILE`)

Set `LAYANX_QURAN_AUTOSCHEDULE=true` to create two daily schedules. Default slots are 08:00 and 20:00 local process time; they can be changed with the four schedule environment variables.

## Production flow

`quran.publish_next` selects the next unpublished range, downloads recitation audio only into a temporary working directory, probes each ayah duration, chooses a consecutive range in the 30–60 second window, renders the vertical video, deletes temporary audio, then publishes the same MP4 to the configured platforms. A JSON ledger records the deterministic idempotency key and publication IDs.

The system fails closed if the recitation rights record is missing, pending, rejected, lacks social-video permission, lacks proof, or does not cover every target platform.

## Platform notes

TikTok local-file Direct Post uses the official FILE_UPLOAD path and chunked upload. TikTok requires the `video.publish` scope and creator authorization; unaudited clients are restricted to private viewing until audit. YouTube uploads use `videos.insert` and require OAuth authorization with the upload scope. Both platforms can require platform-side review/audit before public automated posting.

## Content attribution

Rendered/caption metadata includes `Quran data provided by Quran Foundation.` Recitation and translation credits are kept separate and use the rights catalog's configured credit text. The pipeline does not permanently cache QF API audio; the downloaded audio is temporary build input.

## Important operational boundary

A green pipeline/CI result does not mean external platform accounts are authorized. The final live gate is: approved recitation rights + production QF credentials + authorized YouTube/TikTok OAuth + platform app approval/audit where required + successful local render/verification.


## Validation status

Strict TypeScript indexing checks and scheduler tuple validation are fixed; CI must pass before merge. External recitation licensing and platform approvals remain fail-closed prerequisites for live publication.


## Admin configuration

Quran Foundation credentials are managed from the LayanX Admin Quran branch. Use `GET /v1/quran/admin` to read non-secret status, `PUT /v1/quran/admin` to save settings, and `POST /v1/quran/admin/test` to validate the configured account against Surah 1. Client ID and Client Secret are stored in the local encrypted secret vault and are never returned by the admin read endpoint. You can clear them with `POST /v1/quran/admin/clear-credentials`.

YouTube and TikTok OAuth connections can be selected in the same Quran admin settings using their connection IDs. The existing OAuth connection center keeps access/refresh tokens in the local encrypted vault and refreshes them before publication.

Environment variables remain supported as a backward-compatible fallback for local development, but they are no longer the primary configuration path.
