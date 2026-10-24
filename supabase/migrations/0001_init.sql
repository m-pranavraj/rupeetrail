-- RupeeTrail — initial Supabase schema
-- Run with: supabase db push   (or paste into the SQL editor)
--
-- Security model: the app has no accounts. Each group membership owns a random
-- token which the browser stores locally and sends in the `x-rt-token` header.
-- Postgres policies compare that header against group_members.token, so a token
-- is the only thing that grants access. Tokens are never selectable by clients.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ tables

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  emoji text not null default '🏖️',
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'active' check (status in ('active', 'reconciling', 'closed')),
  code text not null unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  upi_id text,
  color integer not null default 0 check (color between 0 and 7),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index if not exists group_members_group_idx on public.group_members (group_id);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  description text not null check (char_length(trim(description)) between 1 and 120),
  amount_paise bigint not null check (amount_paise > 0),
  date timestamptz not null default now(),
  category text not null default 'other'
    check (category in ('food', 'travel', 'stay', 'groceries', 'entertainment',
                        'utilities', 'shopping', 'other')),
  payers jsonb not null default '[]'::jsonb,
  split jsonb not null default '{"mode":"equal","participants":[]}'::jsonb,
  notes text,
  acks jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  created_by uuid references public.group_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists expenses_group_date_idx
  on public.expenses (group_id, date desc) where deleted_at is null;

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_member_id uuid not null references public.group_members (id) on delete cascade,
  to_member_id uuid not null references public.group_members (id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null default 'upi' check (method in ('upi', 'cash', 'bank', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'payer_confirmed', 'receiver_confirmed', 'confirmed', 'disputed')),
  note text,
  payer_confirmed_at timestamptz,
  receiver_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_member_id <> to_member_id)
);

create index if not exists settlements_group_idx on public.settlements (group_id);

-- ------------------------------------------------------------------ helpers

-- The membership token sent by the client.
create or replace function public.rt_token()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-rt-token', '');
$$;

-- True when the caller's token belongs to a live membership of this group.
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.token = public.rt_token()
      and m.left_at is null
  );
$$;

create or replace function public.current_member_id(p_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from public.group_members m
  where m.group_id = p_group_id
    and m.token = public.rt_token()
    and m.left_at is null
  limit 1;
$$;

-- Bump the group revision so every device knows the ledger moved.
create or replace function public.bump_group_revision()
returns trigger
language plpgsql
as $$
begin
  update public.groups
     set revision = revision + 1
   where id = coalesce(new.group_id, old.group_id);
  return null;
end;
$$;

drop trigger if exists expenses_bump_revision on public.expenses;
create trigger expenses_bump_revision
  after insert or update or delete on public.expenses
  for each row execute function public.bump_group_revision();

drop trigger if exists settlements_bump_revision on public.settlements;
create trigger settlements_bump_revision
  after insert or update or delete on public.settlements
  for each row execute function public.bump_group_revision();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch
  before update on public.expenses
  for each row execute function public.touch_updated_at();

drop trigger if exists settlements_touch on public.settlements;
create trigger settlements_touch
  before update on public.settlements
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;

-- groups: members read and rename; nobody deletes (close instead).
drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select using (public.is_group_member(id));

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (public.is_group_member(id)) with check (public.is_group_member(id));

-- group_members: members see the roster; you may edit only yourself.
drop policy if exists members_read on public.group_members;
create policy members_read on public.group_members
  for select using (public.is_group_member(group_id));

drop policy if exists members_update_self on public.group_members;
create policy members_update_self on public.group_members
  for update using (id = public.current_member_id(group_id))
  with check (id = public.current_member_id(group_id));

-- expenses / settlements: full access for live members.
drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses
  for select using (public.is_group_member(group_id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert with check (public.is_group_member(group_id));

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
  for delete using (public.is_group_member(group_id));

drop policy if exists settlements_read on public.settlements;
create policy settlements_read on public.settlements
  for select using (public.is_group_member(group_id));

drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements
  for insert with check (public.is_group_member(group_id));

drop policy if exists settlements_update on public.settlements;
create policy settlements_update on public.settlements
  for update using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

-- Tokens must never be readable through the API, so only these columns are granted.
revoke all on public.groups from anon, authenticated;
revoke all on public.group_members from anon, authenticated;
revoke all on public.expenses from anon, authenticated;
revoke all on public.settlements from anon, authenticated;

grant select on public.groups to anon, authenticated;
grant update (name, emoji, status, closed_at) on public.groups to anon, authenticated;

grant select (id, group_id, name, upi_id, color, joined_at, left_at)
  on public.group_members to anon, authenticated;
grant update (name, upi_id) on public.group_members to anon, authenticated;

grant select on public.expenses to anon, authenticated;
grant insert on public.expenses to anon, authenticated;
grant update (description, amount_paise, date, category, payers, split, notes, acks, deleted_at)
  on public.expenses to anon, authenticated;
grant delete on public.expenses to anon, authenticated;

grant select on public.settlements to anon, authenticated;
grant insert on public.settlements to anon, authenticated;
grant update (status, note, payer_confirmed_at, receiver_confirmed_at)
  on public.settlements to anon, authenticated;

-- ------------------------------------------------------------------ RPCs

-- Create a group and its first member in one transaction.
create or replace function public.create_group(
  p_name text,
  p_emoji text,
  p_member_name text,
  p_upi_id text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
  v_member public.group_members;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A group needs a name.';
  end if;
  if coalesce(trim(p_member_name), '') = '' then
    raise exception 'Tell the group your name.';
  end if;

  insert into public.groups (name, emoji)
  values (trim(p_name), coalesce(nullif(trim(p_emoji), ''), '🏖️'))
  returning * into v_group;

  insert into public.group_members (group_id, name, upi_id, color)
  values (v_group.id, trim(p_member_name), nullif(trim(p_upi_id), ''), 0)
  returning * into v_member;

  return json_build_object(
    'group_id', v_group.id,
    'member_id', v_member.id,
    'token', v_member.token,
    'code', v_group.code
  );
end;
$$;

-- Join an existing group with its invite code.
create or replace function public.join_group(
  p_code text,
  p_member_name text,
  p_upi_id text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
  v_member public.group_members;
  v_color integer;
begin
  if coalesce(trim(p_member_name), '') = '' then
    raise exception 'Tell the group your name.';
  end if;

  select * into v_group
  from public.groups
  where code = upper(trim(p_code));

  if v_group.id is null then
    raise exception 'That invite code is not valid.';
  end if;
  if v_group.status = 'closed' then
    raise exception 'This group is closed.';
  end if;

  select count(*) % 8 into v_color
  from public.group_members
  where group_id = v_group.id;

  insert into public.group_members (group_id, name, upi_id, color)
  values (v_group.id, trim(p_member_name), nullif(trim(p_upi_id), ''), v_color)
  returning * into v_member;

  update public.groups set revision = revision + 1 where id = v_group.id;

  return json_build_object(
    'group_id', v_group.id,
    'member_id', v_member.id,
    'token', v_member.token,
    'code', v_group.code
  );
end;
$$;

-- Public preview for an invite link (safe fields only).
create or replace function public.invite_preview(p_code text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'id', g.id,
    'code', g.code,
    'name', g.name,
    'emoji', g.emoji,
    'status', g.status,
    'member_count', (
      select count(*) from public.group_members m
      where m.group_id = g.id and m.left_at is null
    )
  )
  from public.groups g
  where g.code = upper(trim(p_code));
$$;

-- Touch a group revision after a metadata change.
create or replace function public.touch_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Not a member of this group.';
  end if;
  update public.groups set revision = revision + 1 where id = p_group_id;
end;
$$;

-- Move a settlement through its confirmation states.
create or replace function public.confirm_settlement(p_settlement_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.settlements;
  v_me uuid;
begin
  select * into v_row from public.settlements where id = p_settlement_id;
  if v_row.id is null then
    raise exception 'That payment no longer exists.';
  end if;

  v_me := public.current_member_id(v_row.group_id);
  if v_me is null then
    raise exception 'Not a member of this group.';
  end if;

  if p_action = 'paid' then
    if v_me <> v_row.from_member_id then
      raise exception 'Only the payer can confirm this.';
    end if;
    update public.settlements
       set payer_confirmed_at = now(),
           status = case when receiver_confirmed_at is not null then 'confirmed'
                         else 'payer_confirmed' end
     where id = p_settlement_id;
  elsif p_action = 'received' then
    if v_me <> v_row.to_member_id then
      raise exception 'Only the receiver can confirm this.';
    end if;
    update public.settlements
       set receiver_confirmed_at = now(),
           status = case when payer_confirmed_at is not null then 'confirmed'
                         else 'receiver_confirmed' end
     where id = p_settlement_id;
  elsif p_action = 'dispute' then
    update public.settlements set status = 'disputed' where id = p_settlement_id;
  else
    raise exception 'Unknown settlement action.';
  end if;

  update public.settlements set updated_at = now() where id = p_settlement_id;
end;
$$;

-- ------------------------------------------------------------------ realtime

do $$
begin
  begin
    alter publication supabase_realtime add table public.expenses;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.settlements;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.group_members;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.groups;
  exception when duplicate_object then null;
  end;
end;
$$;
