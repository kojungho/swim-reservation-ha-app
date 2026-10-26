# Android 0.4.12 / versionCode 18

## Verified

- Same signing certificate as 0.4.7/0.4.11: SHA-256 `027555e7a8662d3029c1c29112723855d40c490e17ea4410985d783ea78a3d19`.
- Android Gradle unit tests: 33 passed. Includes public projection, anonymous GET-only transport, no credentials/cookies/redirects, bad photo/hash/oversize handling, offline cache retention, silent inspection in isolated slot 6, and one-hour clock alarm scheduling/cancellation.
- Android build and lint completed. No actual campsite reservation/cancellation/payment was executed.
- Emulator replace-install 0.4.11 -> 0.4.12 preserved encrypted profiles, saved schedules, draft and UI settings. Seeded test data restored afterwards; no uninstall or data clearing.
- Emulator PublicDisplayTestRunner fetched the live HTTPS public settings and hash-verified photo from ha.badara.co.kr, without HA login. Private profile/schedule/draft repository unchanged.
- Targeted Chromium/shared/API checks: 12 passed, covering 320/390/1280 widths, progressive required fields, compact two-column selection, shared app/addon UI source identity, selected-person lookup/stop, settings persistence and auto-cancel receipt handling.
- HA integration unit/anonymous HTTP tests: 7 passed. Sensitive extra fields stripped; unknown paths rejected, queries rejected, mutations return 405; concurrent readers refresh upstream once/minute.
- HA installed and Core restarted after explicit approval. Live anonymous GET display/map returned 200, matching SHA-256. POST display returned 405, ordinary /api/states and /api/config still returned 401, unknown public path returned 404.
- Existing waiting addon plan remained waiting for 2026-11-01 00:00 KST after Core restart. Addon itself was NOT restarted or replaced.

## Scope / remaining validation

- Existing full legacy addon UI suite has stale expectations for old select-all controls, unrestricted later steps, zone suffixes, automatic all-person lookup and old version strings. It is NOT reported as fully passing. Targeted replacement workflow tests above passed; a full-suite migration remains.
- Phone hardware/background power management and actual paid bookings were not tested.
- Public integration works with running addon 2.15.16. New menu visibility/name editing controls are in addon source 2.15.17; the running addon is not automatically upgraded while its booking wait is active.
- Public main photos are intentionally anonymous; absence of a download button is not copy protection. Never publish a photo containing personal information.

Installation and rollback: see `ha_integration/README.md`. HA configuration backup: `/config/configuration.yaml.before-swim-phone-20261026`.
