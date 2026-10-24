# Supabase backend (ready to switch on)

The app ships with two interchangeable backends:

| | Default | Optional |
|---|---|---|
| Data | Cloudflare D1 via the Worker in `worker/` | Supabase Postgres |
| Realtime | Sites realtime rooms | Supabase `postgres_changes` |
| Auth | device member token (`x-rt-member`/`x-rt-token`) | same token, sent as `x-rt-token` |

Nothing is stubbed: the SQL below creates real tables, policies and functions,
and `src/lib/supabase-service.ts` is a complete typed data layer. The app keeps
using the Worker until you point it at Supabase, so the published site works
today with or without Supabase.

## 1. Create the project

1. <https://supabase.com/dashboard> → New project (any region close to India).
2. Copy **Project URL** and **anon public key** from Settings → API.
3. Put them in `.env.local` (see `.env.example`):

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Never use the `service_role` key in the browser build.

## 2. Apply the schema

```bash
npx supabase login
npx supabase link --project-ref <your-ref>
npx supabase db push          # applies supabase/migrations/0001_init.sql
```

Or paste `supabase/migrations/0001_init.sql` into the dashboard SQL editor and
run it once. It is idempotent (`create table if not exists`, `drop policy if
exists`), so re-running is safe.

## 3. What the schema gives you

* `groups`, `group_members`, `expenses`, `settlements` — amounts are integer
  **paise**, exactly like the client model.
* `payers`, `split` and `acks` are `jsonb` and mirror `src/types.ts` one to one.
* A trigger bumps `groups.revision` on every ledger write, which is what the
  client uses to detect a newer snapshot.
* Soft deletes (`deleted_at`) keep history intact.
* RLS: a caller sees a group only if their `x-rt-token` matches a live
  `group_members.token`. Tokens are revoked from the API grants, so they can
  never be read back.
* RPCs: `create_group`, `join_group`, `invite_preview`, `touch_group`,
  `confirm_settlement`. Create/join return `{group_id, member_id, token, code}`.
* Realtime publication includes all four tables, so
  `subscribeToGroup()` in `src/lib/supabase-service.ts` receives inserts,
  updates and deletes.

## 4. Using the Supabase layer

```ts
import { createGroup, fetchGroupSnapshot, addExpense, subscribeToGroup } from './lib/supabase-service'

const authored = await createGroup({ name: 'Goa plan', emoji: '🏖️', memberName: 'Arjun', upiId: 'arjun@okaxis' })
// store authored.token on the device — it is the membership credential

const snapshot = await fetchGroupSnapshot(authored.group.id, authored.token, authored.me.id)
const stop = subscribeToGroup(authored.group.id, authored.token, () => refetch())
```

All calls take the token and build a client that sends it in `x-rt-token`, so
policies apply to reads *and* realtime.

## 5. Free-tier notes

* 500 MB database, 2 GB egress, 200 concurrent realtime connections.
* Realtime only streams tables in the publication — already handled above.
* Pause on inactivity: the free project sleeps after ~1 week idle; the first
  request after that takes a few seconds.

## 6. Render

The frontend is a static Vite build, so Render needs no special backend:

* Build command: `npm ci && npm run build`
* Publish directory: `dist`
* Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

If you later serve the Worker API from Render instead of Cloudflare, run the
same `worker/index.ts` behind a Node/Wrangler-compatible runtime — but the
Cloudflare deployment already handles it, so a static Render site plus Supabase
is the simpler path.
