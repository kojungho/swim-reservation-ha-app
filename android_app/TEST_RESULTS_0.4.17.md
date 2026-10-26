# Android 0.4.17 (23) / addon 2.15.22

- Shared site-choice action is visually aligned to the right of the room section title; the former toolbar row no longer reserves vertical space. Per-person site editors align their action with the corresponding person's heading. Source wrappers and existing action handlers stay intact, preventing stale cloned buttons and preserving popup/status updates.
- A user checking the only currently selectable site triggers the existing validated Done action exactly once and closes the popup. Multiple candidates still require Done. Opening a popup, deselecting, cancelling or refreshing availability never applies automatically. Site selection does not execute a reservation.
- UI tests at 320/390/1280px passed in both clients; per-person headings checked at 390px. One-option apply, multiple options, cancellation, deselection and a live two-to-one candidate transition passed. Shared site-choice.js and booking-flow source equality retained.
- Targeted UI regression: 8 passed; final site-choice/per-person checks: 2 passed. Android JVM: 42 passed; build and lint successful. This does not claim completion of the legacy full UI suite migration described in 0.4.12.
- Emulator 0.4.16 -> 0.4.17 replace-install retained encrypted profiles, registered schedules, draft and settings; restored original emulator data; no booking started.
- APK 2,836,653 bytes, SHA-256 `c46a2a836efcd4c6ceacf2a74d32f6875bd32116be9721f2495e4de76f84430b`.
- Existing signing certificate SHA-256 retained: `027555e7a8662d3029c1c29112723855d40c490e17ea4410985d783ea78a3d19`.
- No actual campsite booking/cancellation/payment executed. Physical phone installation requires the user's Android installer approval.
- Public 0.4.17 APK downloaded and certificate/hash verified before update registration; minimum supported version remains 5 and changeType fix.
