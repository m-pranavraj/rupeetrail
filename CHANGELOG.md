# Changelog

## 2.0.0 (12) — 2026-10-26

The Android app catches up with the web app and gets its own design language.

- **Rebrand:** RupeeSplit is the rebranded name for all user-facing elements — app
  name, splash, screens, share text, web title and docs. Infrastructure names
  (Worker `rupeetrail-api`, D1 database, Android package id) stay stable so the
  live deployment and the update path are untouched.
- **New design system:** layered dark palette, gradient hero surfaces, spring
  bottom sheets with drag-to-close, animated segmented controls and tabs,
  staggered list entrances, haptics, and keyboard-aware forms that scroll the
  focused field above the keyboard.
- **Full expense editor:** equal / exact ₹ / percent / shares splits with a live
  per-person preview, several payers with individual amounts, categories,
  notes, quick date chips, and validation that mirrors the server.
- **Bill scanning in the APK:** camera or gallery → Google ML Kit OCR on-device →
  the shared receipt parser (items, GST, discounts, totals, confidence).
- **Quick add:** the roster-aware natural-language parser, typed instead of
  spoken.
- **Trip map:** keyless OpenStreetMap tiles, expense pins with amounts, per-stop
  list and a trip wrap total. Place tags are stored on the device.
- **Ledger depth:** expense detail with shares and confirmations, disputes with
  reasons and resolutions, per-member balance maths, CSV export of the whole
  trip, UPI pay links, group rename/close/reopen, member management, invite
  copy/share/WhatsApp.
- **Release:** the Android workflow now stamps a rising version code, signs with
  the release keystore, verifies the APK and republishes the stable release asset
  the existing update manifest already points at.

## 1.0.0 (1) — 2026-10-24

First native Android build: phone + PIN accounts, shared ledgers with live refresh, balances, settlement recording, and adding people who have not joined yet. Online-only by design.
