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
- Licensed recitation catalog.
- Arabic RTL subtitle renderer.
- FFmpeg composition using CreatorEngine.
- Two-publications-per-day scheduler.
- OAuth and publication-status reconciliation.
- End-to-end tests with local fixture media.