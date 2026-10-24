# RupeeTrail — launch plan: Render backend, Supabase Postgres, Android APK

Status: plan for the move away from Cloudflare Workers/D1 + Sites realtime.
Scope: backend on Render, data in Supabase Postgres, Android app (Capacitor) with
prompted APK updates, accounts keyed on a unique phone number with a PIN and **no
SMS OTP**.

Every number below is either measured from this repo or cited from vendor docs
(links at the end). Anything not verified is marked **verify**.

---

## 1. Target architecture

```
Android APK (Capacitor 8, WebView + native plugins)
   │  HTTPS  /api/*         → Render Web Service (Node 22 + Hono)  :10000
   │  WSS    /api/ws?ticket → same service, same port
   │  no direct DB access
   ▼
Render service ── pg Pool (Supavisor session :5432) ──► Supabase Postgres
        │                                              (public schema, RLS on)
        └── pg Client LISTEN "ledger_events" ──► fan out to sockets
Supabase Storage bucket "releases" (APK files, public read)
```

Why this shape:

- The app already talks to a server-authoritative REST API (`src/lib/api.ts`) and
  only ever needs a "revision changed, reload the snapshot" pulse from realtime.
  Keeping a Node API preserves that contract; the UI barely changes.
- Supabase Realtime Postgres Changes authorises with JWT claims over RLS — the
  app's per-member `x-rt-token` header cannot authorise a Realtime subscription.
  Server-side WS fan-out via `LISTEN/NOTIFY` avoids that whole problem and keeps
  one auth model. (Supabase private Broadcast channels with a signed JWT are the
  alternative; see §4.5.)
- The browser never holds a database key. All access goes through Render, so the
  Supabase service/secret key stays server-side.

The existing Cloudflare deployment stays up as a read-only fallback until the
Render cutover is signed off (§7.4).

---

## 2. Decisions to make now

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | APK distribution | **Direct APK download first**, Play Store later | No review delay, but users must enable "install unknown apps"; Play gives automatic updates later |
| D2 | Render plan | **Paid 0.5 CPU / 512 MB (`0.5c-512mb`, $7/mo)** | Free spins down after 15 min idle with ~1 min cold start — that kills realtime sockets and feels broken |
| D3 | Supabase plan | **Free to build, Pro ($25/mo) at public launch** | Free pauses a project after 1 week of inactivity and has no daily backups |
| D4 | Realtime transport | **Node WS + Postgres `LISTEN/NOTIFY`** | No JWT/RLS coupling, works with the current client, no per-message quota |
| D5 | Legacy devices without an account | **Force the phone+PIN signup on first launch**, import their groups as unclaimed members | Clean model; pre-launch user count is small |
| D6 | PIN length | **6 digits for new accounts**, keep accepting 4 for migrated ones | 10× the search space for the only secret in a no-OTP design |

Anything you defer changes the phase estimates in §10.

---

## 3. Accounts: unique phone number, PIN, no OTP

### 3.1 Rules

- Accept `9876543210`, `+91 98765 43210`, `098765…`; normalise to
  `phone_e164` (`+919876543210`) and keep `phone_national` for display.
- **Uniqueness is a database constraint**, not an application check:
  `create unique index users_phone_key on users (phone_e164)`. A duplicate insert
  raises `23505`, which the API maps to `409` with
  "That number already has an account — sign in instead."
- Login failures are generic ("number or PIN is wrong") so the login route does
  not confirm which numbers exist. Registration must say the number exists (a
  silent failure is worse UX than the enumeration it avoids).
- PIN is hashed server-side. Keep the current scheme for migrated rows and use
  scrypt for new ones (§7.3).

### 3.2 Why this is riskier than OTP, and what compensates

Without an OTP, **possession of the number is never proven**: whoever registers a
number first owns that account, and a stolen PIN is a full takeover. Compensate
with, at minimum:

1. 6-digit PIN, `crypto.scrypt` (N=2^15, r=8, p=1, 64-byte digest, random 16-byte
   salt) — ~100 ms per attempt on the Render instance.
2. Server-side lockout: 5 wrong PINs → 15 min, repeat → 1 h, counters in Postgres
   (`failed_attempts`, `locked_until`) so restarts don't reset them.
3. Per-IP throttle on `/api/auth/*` (in-memory token bucket is fine for one
   instance; move to a table when you scale out) and `trust proxy` limited to
   Render's proxy so `X-Forwarded-For` can be trusted.
4. Revocable sessions, listed per device, so a user can kill a stolen session.
5. Never log the PIN, the hash, or the session token. Redact `authorization`.
6. Tell users in the UI: "Anyone with your number and PIN can see these ledgers."

If a number is mistyped into someone else's account, support is the only fix —
worth stating in the privacy policy.

### 3.3 API contract (kept close to today's)

```
POST /api/auth/register  { phone, pin, name, upiId? } → 201 { token, user, memberships }
POST /api/auth/login     { phone, pin }               → 200 { token, user, memberships }
POST /api/auth/logout    Authorization: Bearer <token> → 200
GET  /api/auth/me        Authorization: Bearer <token> → 200 { user, memberships }
POST /api/auth/pin       { currentPin, newPin }        → 200
```

Sessions are opaque 32-byte tokens, stored as SHA-256 hashes (`sessions.token_hash`),
sent as `Authorization: Bearer`. Opaque beats JWT here: instant revocation, no key
rotation, no clock skew. The group-scoped `x-rt-member` / `x-rt-token` headers
disappear; membership is derived from `sessions.user_id` + `group_members.user_id`.

---

## 4. Backend on Render

### 4.1 Runtime

- Node 22, TypeScript, **Hono** (same routing style as `worker/index.ts`, so the
  port is mostly mechanical: 1,299 lines, ~15 routes).
- `pg` for Postgres, `ws` for sockets, `zod` for input validation (the Worker's
  hand-rolled `text()/integer()/upiOf()` helpers map 1:1).
- Listen on `process.env.PORT ?? 10000` and `0.0.0.0` — Render routes both HTTP
  and WebSocket traffic to that port. Use `wss://` in the client.
- `/api/health` returns `{ ok, db: 'up', revision }` and is the Render health
  check. Keep the JSON shape the smoke scripts expect.
- `SIGTERM`: stop accepting connections, close sockets, drain the pool (Render
  gives 30 s by default, configurable to 300 s).

### 4.2 Render blueprint (`render.yaml`)

```yaml
services:
  - type: web
    name: rupeetrail-api
    runtime: node
    plan: 0.5c-512mb
    region: singapore           # verify: closest to India
    rootDir: server
    buildCommand: npm ci && npm run build
    preDeployCommand: npm run db:migrate   # paid plans only
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL       # Supavisor SESSION pooler, port 5432
        sync: false
      - key: SESSION_PEPPER     # not needed if tokens are plain SHA-256
        sync: false
      - key: REALTIME_TICKET_SECRET
        sync: false
      - key: APP_ORIGIN
        value: https://app.rupeetrail.in
```

Secrets go in the dashboard (`sync: false`), never in the YAML or the repo.
`preDeployCommand` does not exist on the free plan, so Free deploys need a manual
`npm run db:migrate` run.

### 4.3 Supabase connection — the gotcha

Render does **not** support outbound IPv6, and Supabase's direct connection is
IPv6-only unless you buy the IPv4 add-on. Use Supavisor:

| Use | Connection | Notes |
|---|---|---|
| API queries | **Session pooler, port 5432** | IPv4, supports prepared statements |
| `LISTEN/NOTIFY` | same session pooler connection | Transaction pooler (6543) cannot do this |
| Nightly `pg_dump` | session pooler | Or local machine via `supabase db dump` |

Avoid the transaction pooler (6543) for the WS listener; it drops session state.
Pool size: start at `max: 5` for the API plus 1 dedicated `LISTEN` client. Scale
instances only after checking the project's connection budget.

### 4.4 Realtime

- `POST /api/realtime/ticket` (authenticated) → `{ ticket, expiresAt, websocketUrl }`.
  Ticket = HMAC-signed `{ groupId, userId, exp }`, 60 s TTL, single use.
- `GET /api/ws?ticket=…` upgrades, checks membership **again** in Postgres, joins
  an in-memory room `group:<id>`.
- Every write runs `NOTIFY ledger_events, '<json>'` inside the transaction, so the
  notice only fires on commit. One dedicated `LISTEN` client fans out to all
  sockets held by this instance.
- Message is deliberately tiny: `{ groupId, revision, kind }`. Clients reload the
  authoritative snapshot (`GET /api/groups/:id`) exactly as today
  (`src/lib/realtime.ts` already does this).
- Client reconnects with backoff and a fresh ticket. Render ends sockets on
  deploy/restart; that must be a non-event in the UI.

If you later prefer Supabase Realtime: enable private Broadcast channels, mint a
short-lived JWT per membership on `/api/realtime/token`, set
`supabase.realtime.setAuth(jwt)`, and put RLS policies on `realtime.messages`
keyed on the group id in the topic. That is more moving parts than a WS server
for the same "revision changed" signal.

### 4.5 Endpoint port list

Same paths as the Worker today, plus accounts and releases:

```
POST   /api/auth/register | login | logout | pin
GET    /api/auth/me
POST   /api/groups
POST   /api/groups/join
GET    /api/invite/:code
GET    /api/groups/:id                    snapshot (group + expenses + settlements + me)
PATCH  /api/groups/:id                    rename / emoji / status
PATCH  /api/groups/:id/me                 my name / upi
POST   /api/groups/:id/members            add someone who hasn't joined
DELETE /api/groups/:id/members/:memberId  remove unused placeholder
POST   /api/groups/:id/expenses
PATCH  /api/groups/:id/expenses/:expenseId
DELETE /api/groups/:id/expenses/:expenseId
POST   /api/groups/:id/expenses/:expenseId/ack
POST   /api/groups/:id/expenses/:expenseId/resolve
POST   /api/groups/:id/settlements
POST   /api/groups/:id/settlements/:id/confirm
POST   /api/realtime/ticket
GET    /api/ws
GET    /api/app/releases?platform=android&channel=stable&currentCode=42
```

Keep `revision` compare-and-set on the group row so two phones writing at once
still conflict loudly (`409`) instead of clobbering.

### 4.6 Environment variables

| Name | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Render secret | Supavisor session pooler, `?sslmode=require` |
| `REALTIME_TICKET_SECRET` | Render secret | 32+ random bytes |
| `APP_ORIGIN` | Render env | Used for absolute invite links |
| `SUPABASE_URL` | Render env | Only if server uploads APKs to Storage |
| `SUPABASE_SECRET_KEY` | Render secret | Server only; bypasses RLS |
| `ADMIN_TOKEN` | Render secret | Protects release publishing |
| `SENTRY_DSN` | optional | Crash reporting |

Nothing database-related ever gets a `VITE_` prefix — that would ship it to the
APK.

---

## 5. Supabase schema

Keep `public` as the app schema. Clients get **no** database role; RLS exists so
that a leaked anon/publishable key still cannot read ledgers.

```sql
-- accounts ------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  phone_national text not null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  upi_id text,
  pin_scheme text not null default 'scrypt-v1',   -- 'pbkdf2-sha256-30k' for migrated rows
  pin_hash text not null,
  pin_salt text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index users_phone_key on public.users (phone_e164);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index sessions_user_idx on public.sessions (user_id) where revoked_at is null;
```

Group tables start from `supabase/migrations/0001_init.sql` and change as follows:

- `group_members`: add `user_id uuid references public.users(id)`,
  `is_placeholder boolean not null default false`, drop `token`/`token_hash`
  (see §7.3 for the transition), keep `legacy_id text`.
- `groups`: add `legacy_id text`, `closed_at` (already present).
- `expenses` / `settlements`: add `legacy_id text`, keep JSONB `payers`/`split`/
  `acks` untouched — the client maths already understands them.
- Add `app_releases` for the updater (§8).
- Add `audit_log` (`actor_user_id`, `group_id`, `kind`, `at`, `detail jsonb`) —
  cheap, and makes "who removed this expense" answerable.

RLS posture:

```sql
alter table public.users enable row level security;
-- No policies for anon/authenticated: only the server (secret key) reads these.
revoke all on public.users, public.sessions from anon, authenticated;
```

The server uses the secret key (`service_role` semantics) and **must do its own
authorisation** — the key bypasses RLS, so every query is scoped by
`user_id` derived from the session, never by a client-supplied id.

Keys: Supabase is deprecating the legacy `anon`/`service_role` JWTs by the end of
2026 — create the project with the new publishable/secret keys and store the
secret in Render only.

Storage: bucket `releases`, public read, uploads through the server or CI with the
secret key. Files are APKs (10–30 MB); check the current storage allowance for
your plan before publishing dozens of builds.

Access rules for placeholders: an `is_placeholder` member has `user_id = null`.
When joining, offer the placeholder list ("Are you Ravi?") instead of matching on
names — name matching silently claims the wrong person when two people share a
first name.

---

## 6. Data migration from D1

D1 stores one JSON document per group in `groups.doc` plus a `users` table.

### 6.1 Steps

1. **Freeze** writes: put the current deployment in `reconciling` state or set a
   maintenance flag; note the max `updated_at`.
2. **Export**
   `npx wrangler d1 export rupeetrail-db --remote --output backup.sql` and
   `npx wrangler d1 execute rupeetrail-db --remote --json --command "select doc from groups" > groups.json`.
   Archive both in the repo's release notes (not the repo).
3. **Transform** (`scripts/d1-to-sql.mjs`): for each group document, emit rows for
   `groups`, `group_members`, `expenses`, `settlements`; for the `users` table,
   emit `public.users` rows.
4. **IDs**: keep the text ids as `legacy_id` and generate deterministic UUIDv5
   (`uuidv5('g_ab12cd34ef', NAMESPACE)`) so a re-run is idempotent and links stay
   stable. Every cross-reference (`payers[].memberId`, `split.participants`,
   `createdBy`, `from`/`to`) maps through the same table.
5. **Passwords**: `pin_scheme = 'pbkdf2-sha256-30k'`, `pin_hash`/`pin_salt` copied
   verbatim. They are **not** re-hashable (PBKDF2 output can't be re-derived), so
   verification keeps the old scheme and upgrades on the next successful login
   (§7.3).
6. **Import** with `COPY … FROM STDIN` inside one transaction; then
   `setval` nothing (UUIDs), and `analyze`.
7. **Verify**, per group:
   - counts: members / expenses / settlements match the JSON;
   - `revision` matches;
   - recompute every net balance from the Postgres rows using the same maths as
     `src/lib/balances.ts` and compare with the D1 document via
     `computeBalances` on the exported JSON — must be paise-identical;
   - spot-check three bills by hand.
8. **Rehearse twice** on a staging Supabase project with a production copy before
   touching production.

### 6.2 Rollback

Cloudflare stays deployed and its D1 untouched for 14 days after cutover. Rollback
= point the app's API base back at the Cloudflare host (a build-time flag, §7.1)
and accept that writes made on Render in between are not back-propagated —
announce a short freeze instead of pretending otherwise.

---

## 7. Client and app

### 7.1 Switching the API

- `src/lib/api.ts`: replace the relative `/api` base with
  `import.meta.env.VITE_API_BASE ?? ''`; send `Authorization: Bearer` instead of
  `x-rt-member` / `x-rt-token`.
- `src/lib/realtime.ts`: the ticket payload already carries `websocketUrl`; point
  it at `wss://<render-host>/api/ws`.
- `src/lib/session.ts`: memberships become `{ groupId, name, ... }` without group
  tokens; add the account token under a new key and migrate/clear the old keys.
- Keep a `VITE_API_BASE` build for staging so both backends are reachable during
  the cutover.

### 7.2 Capacitor 8 (Android)

```bash
npm i @capacitor/core @capacitor/android
npm i @capacitor/app @capacitor/camera @capacitor/share @capacitor/browser \
      @capacitor/status-bar @capacitor/keyboard @capacitor/preferences
npx cap init "RupeeTrail" app.rupeetrail --web-dir=dist
npx cap add android
```

Settings that matter:

- `minSdk 24`, `compileSdk/targetSdk 36`, AGP 8.13, Gradle 8.14.3, JDK 21, Node 22
  (Capacitor 8 defaults).
- `server.androidScheme: 'https'`, `allowMixedContent: false`.
- Session token in **EncryptedSharedPreferences** via a secure-storage plugin, not
  `localStorage` (WebView storage is readable by anyone with the device).
- Hardware back button → `@capacitor/app` `backButton` handler (close sheet,
  then navigate, then exit).
- Invite links: intent filter for `https://app.rupeetrail.in/join/*` plus
  `assetlinks.json` on the domain; hash routes (`#/join/CODE`) also work from a
  plain link, but App Links are the reliable path.

Native gaps the WebView will hit — budget for these:

| Feature | Problem in WebView | Fix |
|---|---|---|
| Camera bill scan | `<input type=file>` works but is clunky; no camera permission rationale | `@capacitor/camera` + `getPhoto`, then feed the blob to `src/lib/image-prep.ts` |
| Voice split | Web Speech API is unreliable/absent in Android WebView | `@capacitor-community/speech-recognition` (Android SpeechRecognizer) or a recorded clip sent nowhere — parsing stays on device |
| Tesseract | Worker + wasm must be served from the app bundle, not a CDN | vendor `tesseract.js` core/worker/lang data into `public/`, keep the first-run download off |
| Share invite | `navigator.share` may be missing | `@capacitor/share` |
| UPI links | `upi://` must open the installed app | `@capacitor/app` `appUrlOpen` fallback: if no handler, open the Play Store / show the id to copy |
| Clipboard | works, but permission quirks on Android 13+ | `@capacitor/clipboard` |

Release build:

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

Sign with a keystore generated once (`keytool -genkeypair -v -keystore
rupeetrail-release.jks -keyalg RSA -keysize 4096 -validity 10000`), stored only in
GitHub Actions secrets + a password manager. Losing it means every installed copy
must be uninstalled before installing the new signature.

### 7.3 Migrating legacy devices

Default (D5): the first launch after the update shows the account screen. A device
that only had group tokens sees "Your groups are waiting — claim them with your
number", and the API links imported members to the new account when the name
matches a placeholder in that group. Provide a support path for the rest.

If you prefer zero friction, keep reading `group_members.legacy_token_hash` for
60 days in the API, then drop the column.

### 7.4 Staging

- `staging` Render service + a second Supabase project (or a schema) + the same
  APK pointed at staging with a build flag.
- Never point a staging build at production Supabase: the updater's release table
  is shared state.

---

## 8. Prompted APK updates (no Play Store)

Play Core in-app updates do not apply to sideloaded APKs, and
`@capawesome/capacitor-app-update` is a Play Store plugin. Build a small updater.

### 8.1 Manifest

```sql
create table public.app_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'android',
  channel text not null default 'stable',
  version_code int not null,
  version_name text not null,
  apk_url text not null,
  sha256 text not null,
  size_bytes bigint not null,
  notes text,
  min_supported_code int not null,
  mandatory boolean not null default false,
  published_at timestamptz not null default now(),
  unique (platform, channel, version_code)
);
```

```
GET /api/app/releases?platform=android&channel=stable&currentCode=42
200 { latest: { versionCode: 45, versionName: "1.4.0", apkUrl, sha256,
               sizeBytes, notes, mandatory: true, minSupportedCode: 43 },
      updateRequired: true, minSupportedCode: 43 }
204  (already current)
```

`min_supported_code` is the kill switch: below it the app blocks the ledger with a
non-dismissable "Update to continue" sheet.

### 8.2 Client flow

1. On launch and on resume: `GET /api/app/releases?currentCode=<BuildConfig.VERSION_CODE>`.
2. If newer, show a sheet: version, size, notes, **Update** / **Later** (Later
   hidden when `mandatory` or below `minSupportedCode`).
3. Download to app-private storage (native `DownloadManager` or a Capacitor
   plugin using `OkHttp`), show progress, allow cancel.
4. Verify `size_bytes` and SHA-256 of the finished file **before** offering install.
5. Hand the file to Android's installer: `FileProvider.getUriForFile` +
   `ACTION_VIEW` with `application/vnd.android.package-archive` and
   `FLAG_GRANT_READ_URI_PERMISSION`. Declare
   `android.permission.REQUEST_INSTALL_PACKAGES`; if
   `packageManager.canRequestPackageInstalls()` is false, deep-link the user to
   Settings → Install unknown apps for RupeeTrail.
6. Android always shows its own install confirmation — no silent updates exist for
   normal apps, and you should not promise them.
7. After install, `versionCode` increases and the next check returns 204.

`versionCode` must come from native `BuildConfig`, not from the JS bundle; a tiny
Capacitor plugin (`getBuildInfo()` → `{ versionCode, versionName }` and
`installApk({ path })`) is the cleanest way, since Capacitor's App plugin only
exposes `versionName`.

### 8.3 Publishing (CI)

```
tag v1.4.0 → GitHub Actions
  ├─ npm ci && npm run test && npm run build
  ├─ npx cap sync android
  ├─ ./gradlew assembleRelease -PversionCode=45   (code from a version file)
  ├─ apksigner verify --print-certs
  ├─ sha256sum app-release.apk
  ├─ upload to Supabase Storage  releases/rupeetrail-1.4.0.apk
  └─ POST /api/admin/releases (ADMIN_TOKEN) → row in app_releases, min_supported_code
```

Keystore decoding must write to `$RUNNER_TEMP`, never the workspace. Keep the
`versionCode` monotonic; a lower one cannot be installed over a higher one.

### 8.4 Distribution caveats

- Android 14 blocks installs of APKs targeting below API 23; Android 15 raises the
  floor to 24. A targetSdk 36 build is fine.
- Android 16's Advanced Protection Mode blocks sideloading entirely; the app must
  explain the failure instead of looping.
- Google's developer verification rollout started 30 Sep 2026 in Brazil,
  Indonesia, Singapore and Thailand (global in 2027): apps distributed outside
  Play must be registered with a verified developer there. **India is not in the
  first wave**, but register the package name + signing key when it reaches India,
  or go through Play.
- Offer a "download from browser" fallback link for users whose device refuses
  in-app installs.

---

## 9. Environments, CI, observability

| Env | Backend | DB | App build |
|---|---|---|---|
| local | `npm run dev` + `npm run dev:api` (Node, `DATABASE_URL` to a local Postgres or Supabase staging) | local Postgres 16 | `npm run dev` in browser |
| staging | Render service `rupeetrail-staging` | Supabase staging project | APK `staging` channel, `VITE_API_BASE` staging |
| production | Render service `rupeetrail-api` | Supabase production | APK `stable`, signed keystore |

- GitHub Actions: `ci.yml` (typecheck, `npm test`, build, `npm run smoke` against a
  throwaway Postgres service container), `android-release.yml` (§8.3),
  `migrate.yml` (manual dispatch, runs `db:migrate` with a confirmation input).
- Logs: `pino` JSON on stdout (Render captures it), request id per call, no tokens
  or PINs. Sentry optional for the APK (`@sentry/capacitor`).
- Uptime: an external ping every 5 min doubles as a keep-alive; on the paid plan
  it is unnecessary.
- Database: daily backups on Pro before every migration; export a `pg_dump` into
  the release notes for the migration itself.

---

## 10. Phases, estimates, acceptance

Estimates assume one developer, part-time (evenings/weekends) — halve them for
full-time.

| Phase | Work | Est. | Done when |
|---|---|---|---|
| 0 | Lock D1–D6 above; create Render + Supabase projects, region, keys | 0.5 d | `/api/health` from an empty Hono app on Render; Supabase reachable from Render via session pooler |
| 1 | Supabase schema: users, sessions, groups, members, expenses, settlements, releases, audit; RLS + revokes | 1 d | `db:migrate` idempotent; psql shows zero policies for anon |
| 2 | Port the Worker API to Hono + `pg` (auth, groups, members, expenses, settlements, invite) | 4–6 d | existing `scripts/api-smoke.mjs` scenarios pass against Render, rewritten for Bearer auth |
| 3 | Accounts: phone normalisation, scrypt, lockout, sessions, `/auth/*`; client `src/lib/api.ts` + `session.ts` | 3 d | register/login/logout round trip from the phone form; duplicate number → 409; 6 wrong PINs → locked |
| 4 | Realtime: tickets, WS, `LISTEN/NOTIFY`, client reconnect | 2 d | two browsers/devices see a new expense in under 1 s; restart of the service recovers within 5 s |
| 5 | D1 → Postgres migration script, two rehearsals, verification report | 2–3 d | balance parity on every group against the D1 export |
| 6 | Capacitor Android shell, native plugins, deep links, back button, secure storage | 4–6 d | bill scan, voice split, share invite, UPI hand-off all work on a real Android 14+ device |
| 7 | Updater: releases table, endpoint, native download+install, mandatory gating, CI signing | 2–3 d | fresh install → tagged release → prompt → install → 204 on next check; tampered APK rejected |
| 8 | Hardening: rate limits, logs, error copy, privacy policy, deletion flow, DPDP notice | 2–3 d | 10-item security checklist (§11) green |
| 9 | Launch: cutover, monitoring, rollback drill | 1 d | production APK installed from the public link, one group created end to end |

Total: **~3.5–4.5 weeks part-time**, ~2 weeks full-time. Phase 2 is the only long
pole and it is mechanical.

---

## 11. Security & privacy checklist

- [ ] Unique phone index; duplicate registration returns 409 from the constraint.
- [ ] PIN hashed (scrypt for new, PBKDF2 for migrated with transparent upgrade);
      never logged, never in the APK.
- [ ] Lockout counters in Postgres; per-IP throttle on auth routes.
- [ ] Sessions revocable; "signed in on 2 devices" visible in settings.
- [ ] Every query scoped by `sessions.user_id`; no endpoint trusts a client id.
- [ ] Membership checked per request and again on WS upgrade.
- [ ] RLS enabled with zero anon policies; secret key only on the server.
- [ ] CORS allow-list = app origin + `capacitor://localhost` + `https://localhost`
      (Capacitor WebView origins).
- [ ] HTTPS only; HSTS; `X-Content-Type-Options: nosniff`.
- [ ] APK SHA-256 verified before install; keystore never in the repo.
- [ ] `pg_dump` before migrations; D1 export archived; rollback rehearsed.
- [ ] DPDP Act 2023: privacy notice, purpose ("ledger and settlement"), account
      deletion endpoint (cascade), grievance contact, no phone sharing with third
      parties (there is no SMS vendor at all).
- [ ] No analytics SDKs in the APK unless listed in the notice.

---

## 12. Cost

| Item | Monthly |
|---|---|
| Render Web Service 0.5 CPU / 512 MB | $7 (Free = $0 but sleeps after 15 min) |
| Supabase Free | $0 — 500 MB DB, pauses after 1 week idle |
| Supabase Pro at launch | $25 — 8 GB, no pause, daily backups |
| Domain (₹/year ÷ 12) | ~$1 |
| Google Play Console (only if Play) | $25 one-time |
| GitHub Actions | $0 on the free tier |

Realistic: **$7/mo while building**, **~$33/mo at public launch** (with Play, add
$25 once).

---

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No OTP → number-first registration, PIN brute force | Account takeover | 6-digit PIN, lockout, throttles, device session list, honest copy |
| Render free spin-down during testing | Realtime drops, 1 min first load | Paid plan; external keep-alive ping |
| Supabase free pause after 1 week idle | API 500s | Pro before launch; `/api/health` alert |
| Direct Postgres is IPv6-only; Render has no IPv6 | Deploy-day failure | Session pooler from day one |
| Transaction pooler used for `LISTEN` | Realtime silently dead | Use session pooler; assert a startup self-test notice |
| Tesseract in WebView | First scan downloads MBs / fails offline | Vendor worker + wasm in the bundle |
| Web Speech API missing in WebView | Voice feature broken in APK | Native speech plugin behind a feature check |
| Keystore loss | Users must uninstall | Keystore in two secure stores; document the fingerprint |
| Google developer verification (2026→2027) | Sideload installs blocked in some markets | Register package + signing key; Play Store as the durable route |
| Migration corrupts balances | Wrong money shown | Rehearse twice, parity report, 14-day rollback window |
| Supabase legacy keys retired end-2026 | Integration breaks | Create project with publishable/secret keys now |

---

## 14. Day-of-launch checklist

1. `pg_dump` production; archive the D1 export.
2. Freeze writes; run the migration; produce the parity report; unfreeze.
3. Deploy Render (paid), confirm `/api/health` reports `db: up`.
4. Two-device realtime test from staging APK against production API.
5. Publish APK `1.0.0` (`min_supported_code = 1`), check the public download link on
   a clean phone with "install unknown apps" off, then on.
6. Watch Render logs + Supabase DB metrics for 30 min.
7. Announce with the download link and a one-line "your old app still works, update
   from the banner" note if you publish a bridge build first.

---

## 15. What gets built in this repo, in order

```
server/                         Hono app, pg pool, ws hub, auth, routes
server/migrations/0001_accounts.sql
server/migrations/0002_groups.sql
server/migrations/0003_releases.sql
scripts/d1-export.mjs           wrangler export + JSON pull
scripts/d1-to-sql.mjs           doc → rows, UUIDv5 mapping, parity report
render.yaml
capacitor.config.ts
android/                        generated by `npx cap add android`
src/lib/native.ts               camera, share, speech, secure storage, updater bridge
src/components/UpdateSheet.tsx  update prompt (+ mandatory gate)
src/lib/version.ts              release check client
.github/workflows/android-release.yml
.github/workflows/ci.yml
```

Existing files touched: `src/lib/api.ts`, `src/lib/session.ts`, `src/lib/store.tsx`,
`src/lib/realtime.ts`, `src/components/Onboarding.tsx`, `src/components/GroupScreen.tsx`,
`deploy.json` (kept for the Cloudflare fallback), `README.md`.

---

## Sources

- Render WebSockets: https://render.com/docs/websocket
- Render free tier / spin-down: https://render.com/docs/free
- Render compute plans: https://render.com/docs/compute-plans
- Render Blueprint spec: https://render.com/docs/blueprint-spec
- Render → Supabase connection guide (IPv6/pooler): https://render.com/articles/how-to-connect-a-render-service-to-supabase-postgres
- Supabase connection options & pooling: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase pricing: https://supabase.com/pricing
- Supabase Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- Supabase RLS / service role: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API keys (legacy key retirement): https://supabase.com/docs/guides/getting-started/api-keys
- Capacitor Android requirements: https://capacitorjs.com/docs/android
- Capacitor 8 upgrade (AGP/Gradle/SDK): https://capacitorjs.com/docs/updating/8-0
- Android alternative distribution: https://developer.android.com/distribute/marketing-tools/alternative-distribution
- FileProvider setup: https://developer.android.com/training/secure-file-sharing/setup-sharing
- In-app updates are Play Core only: https://developer.android.com/guide/playcore/in-app-updates
- Android developer verification rollout: https://developer.android.com/developer-verification/guides
- Advanced Protection Mode (sideloading): https://developer.android.com/privacy-and-security/advanced-protection-mode
