# Android 0.4.16 (22) / addon 2.15.21

- Same required flow in both clients: reserver information -> period -> site selection. Missing reserver information keeps period closed; missing/invalid period keeps site selection closed. Registered plans and other mode drafts are not rewritten.
- No nights badge before valid dates or after dates are cleared. Opening-time and site-picker behavior retained.
- Native start dialog distinguishes brief time synchronization one hour before execution (or immediately when registered within an hour) from heavier browser/network/CPU use starting at the displayed execution time. Vacancy watching describes CPU sleep between polls. Repetitive payment and cross-device warning text removed from frequent notices; failure/uncertainty safeguards retained.
- Explicit opening notice only: delay 1000, 1000, 2000, 3000 ms after responses, initial GET included in maximum five reads. A proposed delay is not scheduled if it cannot fit before trigger+10s. Both clients recheck the deadline before the next GET. Slow responses may therefore result in fewer than five reads. No overlapping GETs, unknown-layout retry, HTTP 403/429 retry or booking POST replay.
- Android JVM: 42 passed; build and lint successful. Latest guided/calendar/date UI: 10 passed. Camp-engine and retry-policy tests: 14 passed, including five GETs on local delayed opening, stop-during-wait preventing further requests, and second-read form opening followed by exactly one synthetic POST.
- Native local WebView instrumentation: bounded reads, opening on second read, no 429 retry, expired-window stop and cancellation passed. Its beforeFinal hook prevents every POST; no live campsite requests.
- Emulator replace-install 0.4.15 -> final 0.4.16 preserved encrypted profiles, registered plans, draft and settings, then restored original emulator data. No reservation started.
- APK 2,930,042 bytes; SHA-256 `f3e3fcec93639016a01f1de566279d9a34f3d3012252a0796f2dc863a1647df4`.
- Existing certificate SHA-256 `027555e7a8662d3029c1c29112723855d40c490e17ea4410985d783ea78a3d19` retained; local APK signature verified. Public re-download verification is recorded separately after publishing succeeds.
- Booking results that remain uncertain after final submission are not automatically resubmitted; availability alone is not proof of non-receipt. This release does not add final-POST reconciliation/retry.
- Targeted checks only; the legacy full UI suite migration described in 0.4.12 is not claimed complete. Physical phone installation still requires the user's approval.

## Live deployment

- Image workflow 40339627316 completed for both architectures and the multi-architecture manifest, source 8322b4b5585069f840b40fb0a548bd1b447a6c9a.
- Backup-enabled addon 2.15.20 -> 2.15.21 update/restart completed; state started. Existing future 2026-11-01 00:00 KST wait automatically returned to waiting/armed; disabled stopped/completed plans remained unchanged. No manual plan-start API was used.
- All saved IDs/configuration/enabled flags retain SHA-256 `30ac3743c4d932cdc50c0d5bdb7a0fe2d8c18026d638a3d5d6c41fc4bcddff29`. Deployed shared flow matches source/APK `cb134f48ce08051a5884aa80898b9a3ea78ccd174d73b3d6e38e7a8cef20fbc8`.
- GitHub initially returned 500/502 for release creation and a rejected push; read-back confirmed no duplicate release. Publishing recovered. Public 0.4.16 APK was downloaded and its hash/certificate verified before registering the update manifest.
