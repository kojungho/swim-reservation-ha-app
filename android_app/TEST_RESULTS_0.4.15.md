# Android 0.4.15 (21) / addon 2.15.20

- Shared readonly `예약 실행 시간(오픈 예정일)` for pre-open dates only; no separate opening-date label. Immediate run stays hidden without dates. The phone editor clears a stale future trigger when switched to already-open dates; stored registered schedules are not rewritten.
- Month-end check-in moves the checkout picker to the next month. UI tests cover January 31, December 31 and leap-year February 29, with checkout-day exclusion and full-period site availability rules retained.
- Monthly interval controls removed from both clients. Server boot disables persisted prefetch intervals and does not start the timer; legacy writes/refresh endpoints return 410. Fresh reads run on page entry, month navigation and month input change; explicit refresh remains available.
- Same counts-only badge legend, centered month controls and 36x44 month arrows in both clients.
- Eight app menu visibility flags are editable in addon Settings. Public HA projection and native projection allow only these named flags; profiles, contacts, schedules, logs and tokens remain private.
- Nonmember lookup is collapsed by default; name, phone and query button share one row. Detail button is right of status/price, panel takes space only while expanded, receipt rows use 3px gaps.
- No standalone phone-permission menu. Each real run attempt checks notification permission and, where needed, alarms/battery exemptions, offers a system-settings dialog and does not automatically start after permission changes. Silent reads remain silent.
- Android JVM: 38 passed; build and lint successful. Targeted UI/API/settings/calendar/parser/scheduler: 45 passed; final stale-trigger and compact-editor recheck: 4 passed. Public integration: 8 passed. Legacy full UI suite migration described in 0.4.12 is not claimed complete.
- Emulator replace-install from 0.4.14 to final 0.4.15 preserved encrypted profiles, schedules, draft and settings; original test data restored. No booking started.
- APK: 2,927,678 bytes; SHA-256 `cf01e66bcde460e8a293ab26ab9afb3e8171d41a7383b1944d5502c1e4cc7148`.
- Existing certificate SHA-256 retained: `027555e7a8662d3029c1c29112723855d40c490e17ea4410985d783ea78a3d19`.
- Actual campsite booking/cancellation/payment were not executed. Physical phone installation requires the user's installer approval.

## Live verification

- Final image workflow 40334071961 (source aed00106abb0c930b296a81af4369d1e769c748f) completed for amd64, aarch64 and multi-architecture publishing. The existing builders emitted optional `latest` image verification warnings; the versioned release and deployed source hashes were checked separately.
- HA public-display integration 1.0.1 installed with previous files preserved as `.before-0415`; config check passed and Core restart completed. Anonymous display returns all eight menu flags. Private HA states endpoint still returns 401.
- Addon backup-enabled update 2.15.19 -> 2.15.20 completed, state started. Backup count 580 -> 581.
- Saved plan IDs/configuration/enabled flags retain canonical SHA-256 `30ac3743c4d932cdc50c0d5bdb7a0fe2d8c18026d638a3d5d6c41fc4bcddff29`. Existing 2026-11-01 00:00 KST schedule restored to waiting/armed; stopped/completed plans remained stopped/completed. No start API was called.
- Deployed shared booking-flow.js matches source/APK SHA-256 `1e56981958de0a898516b441cef26d663369a829f46064b3b77d6b2ecec0cf51`.
- Live monthly prefetch status: intervalMinutes 0, running false, nextAt null. Existing menu selections retained; new information/lookup/monthly/log flags default visible.
- Public 0.4.15 APK re-downloaded and hash/signature verified; update manifest is versionCode 21, minimum supported version 5, changeType fix.
