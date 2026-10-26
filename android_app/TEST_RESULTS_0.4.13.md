# Android 0.4.13 (19) / addon 2.15.18

- Shared booking-flow CSS/JS and site-choice JS are byte-identical in app/addon.
- Required tags sit inline beside field names. Original numbered titles toggle sections with mouse, touch, Enter and Space; no separate bordered toggle buttons.
- Execution time caption is exactly `예약 실행 시간`. It appears only for pre-open dates, not opened dates or cancellation watch. Existing saved schedules are not rewritten.
- Official site link is at the right of the app-update row. Old generated info panel and empty action placeholders are hidden.
- Site-selection button sits left with no reserved select-all area; bulk actions remain inside the popup.
- Finishing required identity fields advances to stage 3 and opens the picker once (650 ms input debounce). Closing a popup does not re-open it on polling. Restoring an editor is not treated as user input. No booking start or submission is attached to automatic advancement.
- Native multi-person site editors now occupy stage 3 too. Selecting a saved person triggers the same advancement behavior.
- Responsive UI tests cover both app/addon at 320/390/1280 px, including compact empty-site layout, inline labels, header links, keyboard toggling, time visibility and no run/start calls. Extra native multi-person test covers saved-person replacement/rerender.
- Android JVM tests: 33 passed. Build and lint completed.
- Emulator replace-install 0.4.12 -> 0.4.13 preserved encrypted profiles, schedules, draft and settings; original test fixture data restored. Same signing certificate: `027555e7a8662d3029c1c29112723855d40c490e17ea4410985d783ea78a3d19`.
- No actual campsite booking, cancellation or payment was executed. Tests use synthetic/fake reservation responses.

Scope note: this is targeted workflow verification, not a claim that the entire legacy UI suite has been migrated. See 0.4.12 report for existing legacy-test expectations needing migration.
