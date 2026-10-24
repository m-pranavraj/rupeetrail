# Where everything lives: Render, Supabase, and the APK

This is the operational guide. The reasoning behind the choices is in
[docs/launch-plan.md](docs/launch-plan.md); this file is the "which box do I paste
this into" version.

## 1. What runs where

| Piece | Where it runs | What it holds |
|---|---|---|
| Android app | Phone (APK) | Nothing but the session token. No database key, no PIN, no ledger copy. |
| API | **Cloudflare Worker today**; Render once the port lands | Business rules, auth, phone+PIN, realtime fan-out |
| Database | Cloudflare D1 today; **Supabase Postgres** after migration | Every ledger, account, session |
| Realtime | Sites realtime today; **Render WebSocket** after migration | Ephemeral "revision changed" pings only |
| APK file | GitHub Releases asset (simplest) or Supabase Storage bucket `releases` | Signed build, SHA-256 |
| APK update manifest | API env vars / `app_releases` table | Version code, URL, hash, notes |
| Signing keystore | Password manager + GitHub Actions secret | Never in git, never in the APK store listing |

## 2. Secrets: exactly where each one goes

| Name | Lives in | Used by | Notes |
|---|---|---|---|
| `DATABASE_URL` | Render → Environment (secret) | API | Supavisor **session** pooler, port `5432`, `?sslmode=require`. Not the 6543 transaction pooler. |
| `SUPABASE_URL` | Render → Environment | API | `https://<project>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Render → Environment (secret) | API + release publishing | Bypasses RLS. Never in the APK, never in git. |
| `REALTIME_TICKET_SECRET` | Render → Environment (secret) | API | HMAC for 60-second WS tickets |
| `ADMIN_TOKEN` | Render → Environment (secret) | CI → API | Protects `POST /api/admin/releases` |
| `ANDROID_VERSION_CODE` | API host env | Update manifest | Monotonic integer |
| `ANDROID_VERSION_NAME` | API host env | Update manifest | `1.4.0` |
| `ANDROID_APK_URL` | API host env | Update manifest | Public HTTPS link to the APK |
| `ANDROID_APK_SHA256` | API host env | Update manifest | `sha256sum` of the APK |
| `ANDROID_APK_SIZE` | API host env | Update manifest | Bytes |
| `ANDROID_MIN_CODE` | API host env | Update manifest | Below this, the app blocks until updated |
| `ANDROID_RELEASE_NOTES` | API host env | Update manifest | Plain text shown in the prompt |
| `RELEASE_KEYSTORE_BASE64` | GitHub Actions secret | CI | The `.jks` file, base64 |
| `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` | GitHub Actions secrets | CI | Signing credentials |

Rules that are easy to get wrong:

- Anything starting with `EXPO_PUBLIC_` is **inside the APK** — only put the API
  base URL and the version code there.
- The Supabase secret key and the keystore never travel through this chat, a
  commit, or the app bundle.
- On Sites, the same `ANDROID_*` values go in the project environment and the
  Worker picks them up on the next deploy.

## 3. Supabase setup

1. Create a project (choose the region closest to your users; Supabase has
   Mumbai/Singapore). Save the database password in the password manager.
2. SQL editor → paste `supabase/migrations/0001_init.sql`, run. Then
   `supabase/migrations/0002_accounts.sql`, run. Both are idempotent.
3. Project Settings → API: copy the **project URL** and the **secret key** (the
   legacy `service_role` JWT is being retired during 2026; use the new keys).
4. Connect → **Session pooler** → copy the URI (port `5432`). This is the one
   Render can reach: Supabase's direct connection is IPv6-only and Render has no
   outbound IPv6.
5. Storage → create bucket `releases`, public read. Upload APKs here if you do
   not want to use GitHub Releases.
6. Backups: Free has none and pauses a project after a week of inactivity. Pro
   ($25/mo) adds daily backups and no pausing — take it before real users.

## 4. Render setup

The API is still the Cloudflare Worker, so `render.yaml` in this repo describes
the service that the ported Node API will use; it will not deploy until the
`server/` directory exists. The steps are the same either way:

1. New → Blueprint → connect `m-pranavraj/rupeetrail`. Render reads
   [`render.yaml`](render.yaml).
2. Enter the secrets marked `sync: false` (`DATABASE_URL`, and later
   `SUPABASE_SECRET_KEY`, `REALTIME_TICKET_SECRET`, `ADMIN_TOKEN`).
3. Plan: `0.5c-512mb` ($7/mo). The free plan sleeps after 15 minutes idle, which
   drops WebSockets and gives a one-minute cold start.
4. Health check: `/api/health`. Deploy.
5. `preDeployCommand` (migrations) only runs on paid plans; on Free, run
   `npm run db:migrate` manually once against the same `DATABASE_URL`.
6. Build the APK against the new host:

   ```bash
   cd mobile
   EXPO_PUBLIC_API_BASE="https://rupeetrail-api.onrender.com" \
   EXPO_PUBLIC_VERSION_CODE=1 EXPO_PUBLIC_VERSION_NAME=1.0.0 \
   npx expo prebuild --platform android --no-install
   cd android && ./gradlew assembleRelease
   ```

7. Cutover: keep the Cloudflare deployment live and its D1 database untouched
   for 14 days as the rollback path.

## 5. Building and publishing the APK

### Local build

```bash
cd mobile
npx tsc --noEmit
npx expo prebuild --platform android --no-install   # regenerates android/
cd android
./gradlew assembleDebug        # installable, debug-signed
./gradlew assembleRelease      # needs signing config, see below
```

The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

### Release signing (once)

```bash
keytool -genkeypair -v -keystore rupeetrail-release.jks \
  -alias rupeetrail -keyalg RSA -keysize 4096 -validity 10000
```

Keep the file and its passwords in a password manager. Losing the key means every
installed copy must be uninstalled before the next update can install.

### Publishing a version

1. Bump `versionCode` and `version` in `mobile/app.json`.
2. Build the signed APK.
3. Upload it to GitHub Releases (or Supabase Storage `releases`).
4. Record the size and hash:

   ```bash
   sha256sum app-release.apk
   stat -c %s app-release.apk
   ```

5. Put `ANDROID_VERSION_CODE`, `ANDROID_VERSION_NAME`, `ANDROID_APK_URL`,
   `ANDROID_APK_SHA256`, `ANDROID_APK_SIZE` and `ANDROID_RELEASE_NOTES` on the
   API host, and redeploy.
6. Every installed app checks `GET /api/app/releases` on launch and on resume,
   shows the prompt with the notes, and opens the download. Android then asks the
   user to allow the install — no silent updates exist for sideloaded apps.

To force an update (security fix), raise `ANDROID_MIN_CODE` above older builds:
the prompt becomes non-dismissable, because the app checks
`versionCode < minSupportedCode`.

`/api/app/releases` returns `{ latest: null }` until `ANDROID_APK_URL` is set, so
an unpublished build never nags anyone.

## 6. CI (optional, recommended)

`.github/workflows/android.yml` builds a signed APK on a `v*` tag, verifies it
with `apksigner`, attaches it to a GitHub Release, and prints the hash and size
that go into the `ANDROID_*` variables. It needs the keystore secrets above.

## 7. Things that bite

| Symptom | Cause | Fix |
|---|---|---|
| App says "Can't reach RupeeTrail" on every call | Built without `EXPO_PUBLIC_API_BASE`, or the host blocks cleartext | Rebuild with the HTTPS API base |
| Update prompt never appears | `ANDROID_APK_URL` unset, or `ANDROID_VERSION_CODE` not higher than the installed build | Set both, redeploy |
| "Update" downloads but will not install | Unknown-source installs disabled for the browser | Allow installs for that app, then retry |
| Postgres connection refused from Render | Direct Supabase host (IPv6) | Use the session pooler on port 5432 |
| Realtime stays "offline" in the app | WebSocket blocked, or the API is on Cloudflare Sites realtime which validates browser origins | The app polls every 12 s regardless; move realtime to the Render WS server |
| Migration script re-inserts duplicates | Text ids re-mapped randomly | Keep the UUIDv5 mapping and `legacy_id` unique index |

## 8. What is already true in this repo

- `mobile/` is a complete React Native (Expo) Android app: phone+PIN accounts,
  groups, expenses, balances, settlement recording, adding people by name,
  online-only gate, update prompt.
- The Worker already serves the update manifest at `/api/app/releases`.
- `supabase/migrations/0002_accounts.sql` defines the account/session/release
  tables the Render port needs.
- The APK points at the current Cloudflare host until you rebuild with
  `EXPO_PUBLIC_API_BASE` set to the Render URL.
