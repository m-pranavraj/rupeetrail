# RupeeTrail

Shared expense ledger for trips, flats, couples and teams in India. Log what
each person actually paid, see exactly how every share was calculated, and
settle with a UPI link instead of a spreadsheet argument.

Built from the RupeeTrail PRD (Research Edition 2.0, 22 Oct 2026).

## How it works now

- **One account per mobile number.** Create it once with your name, UPI id and a
  4-digit PIN. The number is the unique key (a `UNIQUE` column in D1) and the PIN
  is stored as a PBKDF2 hash; five wrong tries lock it for 15 minutes. Sign in
  with the same number on another phone and every group comes back, because each
  membership is linked to the account and a fresh device token is minted.
- **Add people who haven't joined.** In the invite sheet you can add a name (and
  optional UPI id) for someone who isn't on the app yet. They appear in splits
  and balances straight away, are marked as added-not-joined, and can be removed
  while no money is attached to them. If they later open the invite link and
  join with the same name, they take over that entry and inherit its history.
- **Groups are shared, not local.** A group lives in D1 behind a six-character
  invite code. Creating a group gives you a link such as
  `https://…/#/join/7KQ4M2`; anyone who opens it, enters their own name and UPI
  id, and taps *Join* is in.
- **Live.** Every write is broadcast on the group's realtime room. Open phones
  reload the authoritative snapshot on `ready` and on every revision broadcast,
  and fall back to polling if realtime is unavailable.
- **Scan a bill, on the phone.** *Capture Bill* greyscales and contrast-boosts
  the photo on a canvas, reads it with Tesseract OCR in a browser worker, then
  extracts line items with quantity and rate, CGST/SGST, any discount and the
  printed total. The numbers are cross-checked against each other, so a receipt
  that does not add up is flagged instead of silently trusted. Nothing is
  uploaded and no API key is involved.
- **Dictate a split.** *Explain with your voice* uses the browser's speech
  engine. “Dinner 1200, Priya had the wine for 400, I paid” becomes an exact
  split, with the unexplained balance assigned to whoever paid.
- **Works offline.** An expense entered without a connection is queued on the
  device, shown immediately with a *syncing…* marker, and pushed to the ledger as
  soon as the connection returns. A refresh never loses it.
- **Nothing is seeded.** A new group starts with zero expenses. The only data in
  the app is what real people entered.
- **Settle by UPI.** The settlement plan lists the minimum set of transfers and
  each one carries a `upi://pay?…` link with the receiver's UPI id and amount,
  plus the dual-confirmation flow: a payment only moves balances after both the
  payer and the receiver confirm it.

## Architecture

```
browser (Vite + React SPA)
  │  fetch /api/*        → Worker → D1 (one JSON ledger document per group)
  │  wss ticket          → Sites realtime room `group:<id>`
worker/index.ts          API, accounts, invite codes, token auth, broadcast
src/lib/splits.ts        shared paise-exact split maths (also used by the Worker)
src/lib/balances.ts      net positions + per-line explanations
src/lib/settlement.ts    greedy max-debtor/max-creditor plan
src/lib/receipt.ts       structured receipt extraction + reconciliation
src/lib/voice.ts         spoken-split parsing against the group roster
src/lib/image-prep.ts    canvas clean-up before OCR
src/lib/outbox.ts        offline expense queue
```

Supabase is wired as an alternative backend (schema, RLS policies, RPCs and a
typed data layer). See [SUPABASE.md](SUPABASE.md) to switch it on.

- Every amount is an integer number of paise; rupees appear only at the render
  boundary.
- The ledger document is written with a revision check
  (`UPDATE … WHERE id = ? AND revision = ?`), so two phones adding expenses at
  the same moment cannot overwrite each other. A conflict returns `409` and the
  client reloads.
- Each member holds a 256-bit device token, stored as a SHA-256 hash. It travels
  only in `x-rt-member` / `x-rt-token` headers. The invite code is the access
  control; the token is what stops one group's member reading another group.
- The Worker creates its own table on first use, so a fresh D1 database needs no
  manual SQL. `worker/migrations/0001_init.sql` mirrors that schema for Wrangler.

## Native Android app

The app in `mobile/` is a React Native (Expo) build of the same ledger: phone +
PIN accounts, groups, expenses, balances, settlement recording, adding people who
have not joined, and a prompt when a newer APK exists. It shares the money maths
with the web app (`scripts/sync-native-logic.mjs` copies the pure modules), and it
is **online-only** by design: a shared ledger needs the server.

**Download:** https://github.com/m-pranavraj/rupeetrail/releases/latest — install
with "allow installs from this source" enabled, then sign in with your number.

```bash
cd mobile
npm install
npx tsc --noEmit
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease   # arm64 + debug-signed by default
```

Point it at another backend with `EXPO_PUBLIC_API_BASE` at build time. Publishing
a new version, signing keys and the update manifest are in [DEPLOY.md](DEPLOY.md);
the architecture plan is in [docs/launch-plan.md](docs/launch-plan.md).

The Worker serves the update check at `GET /api/app/releases`; it returns
`{ latest: null }` until a release is configured, so no build nags users by
accident.

## Local development

```bash
npm install
npm run db:local        # create the local D1 schema

# three terminals
npm run dev:realtime    # local realtime helper on :8788
npm run dev:api         # Worker + local D1 on :8787
npm run dev             # Vite on :3000, proxies /api and the websocket path
```

Local D1 state lives in `.wrangler/state`. Delete that directory to start from
an empty ledger.

## Verification

```bash
npm run typecheck      # browser app + Worker
npm test               # 28 tests: split/balance/settlement maths + real DOM flows
npm run smoke          # end-to-end API test against a running dev stack
```

`scripts/api-smoke.mjs` creates a group, joins it from a second "device", adds a
multi-payer expense, confirms and disputes it, settles it from both sides, and
asserts that a subscriber receives the live revision broadcast over a real
websocket. It can also run against a deployment:

```bash
API_ORIGIN=https://<preview-host> SMOKE_ORIGIN=https://<preview-host> npm run smoke
```

## Deploying

`deploy.json` is the Sites manifest: prebuilt Worker (`worker-dist/index.js`),
static assets (`dist`), SPA fallback, realtime enabled. Build first with
`npm run build`, provision a D1 binding named `DB` in the target environment,
then deploy the manifest. `wrangler.jsonc` is for local development only.

## Boundaries

- RupeeTrail is not a payment app: it never holds money, never talks to a PSP,
  and never claims a UPI payment happened. It records what people say happened.
- Invite links are bearer access. Anyone with the link can join until the group
  is closed; members can be removed only by leaving the group on their device.
- Writes require connectivity. Cached snapshots are readable offline, but the
  app does not queue offline mutations.
- The native app does not include bill scanning or voice capture yet: Tesseract
  and the Web Speech API are browser features, and each needs a native
  replacement before it can ship in the APK.
- Not built yet: receipt OCR in the native app, recurring expenses, budgets/charts, provider-level
  settlement verification, and a close-out report for finished trips.
