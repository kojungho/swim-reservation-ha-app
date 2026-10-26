# Android 0.4.14 (20) / addon 2.15.19

- Includes all shared compact-flow and pre-open-only `예약 실행 시간` changes from 0.4.13/2.15.18.
- Central app menu visibility/names are edited in addon Settings -> App menus / App menu names, then saved. App users do not need HA accounts; only public display configuration/photo/submit interval are synchronized.
- Native app automatically re-reads public display configuration on resume and network availability/validation. Concurrent wakeups are coalesced; a network return during a failed read retains one retry. Existing minute-based automatic retries and cached settings/photo remain.
- Browser online event reconnects the app display adapter. Addon uses existing automatic status retry (3~30 seconds), online/resume recovery, and retains unsaved fields. No reload, run/stop/submit/cancel replay is attached to transport recovery.
- Official site text link opens the official page using the existing native external-browser action, not blocked WebView navigation.
- Android JVM tests: 35 passed. Build and lint completed.
- Targeted UI/API/parser/settings/scheduler tests: 38 passed. Includes network disconnect/reconnect with preserved draft and no booking operation, and exact `예약 실행 시간` caption in app/addon at 320/390/1280 px.
- Emulator 0.4.13 -> 0.4.14 replace-install preserved encrypted profiles, saved schedules, draft and settings; original test fixture restored. Same signing certificate: `027555e7a8662d3029c1c29112723855d40c490e17ea4410985d783ea78a3d19`.
- No actual campsite booking/cancellation/payment was executed. Existing server waiting schedules are restored by their persisted IDs/configuration, never manually resubmitted.

## Live deployment verification

- Supervisor backup-enabled update completed: running addon 2.15.16 -> 2.15.19, state started. Backup count increased from 579 to 580.
- All saved plan IDs/names/kinds/configuration/enabled flags have the same canonical SHA-256 before/after: `30ac3743c4d932cdc50c0d5bdb7a0fe2d8c18026d638a3d5d6c41fc4bcddff29`.
- Enabled 2026-11-01 00:00 KST schedule automatically restored to waiting/armed. Stopped and completed plans remained stopped/completed. No plan start API was called.
- Deployed booking-flow.js SHA-256 matches repository source: `e7d59d1be1a4a438d1f092c2790103265b12cefde68b37d702dcf745d7f5fdb4`.
- Addon settings API and anonymous display route both provide appMenus/appMenuLabels. Anonymous public display returns 200; private HA states API still returns 401.
- Public APK re-downloaded and certificate/hash verified. Update manifest is published as versionCode 20 / 0.4.14. Physical phone installation requires the user's Android installer approval; it was not remotely performed.

This is targeted verification; remaining legacy UI suite migration described in 0.4.12 is not represented as completed.
