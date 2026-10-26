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

This is targeted verification; remaining legacy UI suite migration described in 0.4.12 is not represented as completed.
