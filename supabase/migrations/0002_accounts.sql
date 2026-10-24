-- RupeeTrail — accounts, sessions and Android releases
--
-- Run after 0001_init.sql. This is the schema the Render API uses; the browser
-- never talks to Postgres directly, so RLS exists only as a backstop in case an
-- anon key ever leaks.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ users

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  phone_national text not null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  upi_id text,
  -- 'scrypt-v1' for new accounts, 'pbkdf2-sha256-30k' for rows migrated from D1
  pin_scheme text not null default 'scrypt-v1'
    check (pin_scheme in ('scrypt-v1', 'pbkdf2-sha256-30k')),
  pin_hash text not null,
  pin_salt text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- The uniqueness rule is the constraint itself, not an application check: two
-- simultaneous signups with the same number cannot both succeed.
create unique index if not exists users_phone_key on public.users (phone_e164);

-- --------------------------------------------------------------- sessions

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists sessions_user_idx
  on public.sessions (user_id) where revoked_at is null;

-- ------------------------------------------------- group membership link

alter table public.group_members
  add column if not exists user_id uuid references public.users (id) on delete set null,
  add column if not exists is_placeholder boolean not null default false,
  add column if not exists legacy_id text;

create index if not exists group_members_user_idx on public.group_members (user_id);

alter table public.groups add column if not exists legacy_id text;
alter table public.expenses add column if not exists legacy_id text;
alter table public.settlements add column if not exists legacy_id text;

-- A placeholder is someone added by name who has no account yet. Enforce the
-- invariant so a stray update cannot leave a member with neither.
alter table public.group_members
  drop constraint if exists group_members_placeholder_shape;
alter table public.group_members
  add constraint group_members_placeholder_shape
  check (not is_placeholder or user_id is null);

-- -------------------------------------------------------- android releases

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'android' check (platform in ('android', 'ios')),
  channel text not null default 'stable' check (channel in ('stable', 'beta')),
  version_code integer not null check (version_code > 0),
  version_name text not null,
  apk_url text not null,
  sha256 text not null check (char_length(sha256) = 64),
  size_bytes bigint not null check (size_bytes > 0),
  notes text,
  min_supported_code integer not null default 1,
  mandatory boolean not null default false,
  published_at timestamptz not null default now(),
  unique (platform, channel, version_code)
);

create index if not exists app_releases_latest_idx
  on public.app_releases (platform, channel, version_code desc);

-- ------------------------------------------------------------ lock down

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.app_releases enable row level security;

-- No anon policies: only the server's secret key (which bypasses RLS) touches
-- these tables. Revoking grants means even a leaked publishable key reads
-- nothing.
revoke all on public.users from anon, authenticated;
revoke all on public.sessions from anon, authenticated;
revoke all on public.app_releases from anon, authenticated;

-- Releases are public information, so the app may read them with a publishable
-- key if you ever switch the update check to talk to Supabase directly.
grant select on public.app_releases to anon, authenticated;

-- ------------------------------------------------------------ auth attempts
--
-- Lockout counters live in Postgres so a service restart cannot reset them.

create table if not exists public.auth_attempts (
  phone_e164 text primary key,
  failures integer not null default 0,
  last_failure_at timestamptz,
  locked_until timestamptz
);

alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;
