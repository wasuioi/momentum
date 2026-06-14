-- Momentum schema. Paste into Supabase Dashboard > SQL Editor > Run.
-- Multi-user foundation: private diary data, friend-visible live status only.
-- Deploy this together with the owner-scoped app API changes. The old
-- single-user app writes do not include user_id.
--
-- Existing single-user installs need an owner for old days/app_state rows.
-- Fresh database: leave this blank.
-- Existing database with old rows:
--   1. Open Supabase Dashboard > Authentication > Users.
--   2. Copy the existing user's UUID.
--   3. Paste it between the quotes below before running this script.
-- If left blank and there is exactly one auth user, the script uses that user.
-- If there are old rows and zero or multiple auth users, the script stops with
-- a clear error instead of guessing.
select set_config('momentum.legacy_owner_id', '', false);

-- Existing accepted friendships are trusted by profile/live_status read policies.
-- Keep this false unless you have audited every existing accepted friendship row
-- or you are intentionally re-running after admin-seeded friendships.
select set_config('momentum.allow_existing_accepted_friendships', 'false', false);

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null constraint profiles_display_name_not_blank check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists days (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  score int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table if not exists app_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  primary key (user_id, key)
);

-- Remove old broad policies before any fail-fast migration guard can stop.
drop policy if exists "authenticated full access" on days;
drop policy if exists "authenticated full access" on app_state;

-- Upgrade old single-user tables that were created before user_id existed.
do $$
declare
  legacy_owner_id_text text := nullif(current_setting('momentum.legacy_owner_id', true), '');
  legacy_owner_id uuid;
  auth_user_count int;
  rows_needing_owner int;
begin
  alter table public.days add column if not exists user_id uuid;
  alter table public.app_state add column if not exists user_id uuid;

  select
    (select count(*) from public.days where user_id is null)
    + (select count(*) from public.app_state where user_id is null)
  into rows_needing_owner;

  if rows_needing_owner > 0 then
    if legacy_owner_id_text is not null then
      legacy_owner_id := legacy_owner_id_text::uuid;
    else
      select count(*) into auth_user_count from auth.users;

      if auth_user_count = 1 then
        select id into legacy_owner_id from auth.users limit 1;
      else
        raise exception
          'Existing diary rows need an owner. Set momentum.legacy_owner_id at the top of setup.sql to one auth.users.id before running this script.';
      end if;
    end if;

    update public.days set user_id = legacy_owner_id where user_id is null;
    update public.app_state set user_id = legacy_owner_id where user_id is null;
  end if;

  alter table public.days alter column user_id set not null;
  alter table public.app_state alter column user_id set not null;
end $$;

-- Replace old single-column primary keys with user-scoped primary keys.
do $$
declare
  pk_name text;
  pk_columns text[];
begin
  select c.conname, array_agg(a.attname::text order by cols.ordinality)
    into pk_name, pk_columns
  from pg_constraint c
  join unnest(c.conkey) with ordinality as cols(attnum, ordinality) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = cols.attnum
  where c.conrelid = 'public.days'::regclass and c.contype = 'p'
  group by c.conname;

  if pk_name is not null and pk_columns <> array['user_id', 'date'] then
    execute format('alter table public.days drop constraint %I', pk_name);
    pk_name := null;
  end if;

  if pk_name is null then
    alter table public.days add constraint days_pkey primary key (user_id, date);
  end if;

  pk_name := null;
  pk_columns := null;

  select c.conname, array_agg(a.attname::text order by cols.ordinality)
    into pk_name, pk_columns
  from pg_constraint c
  join unnest(c.conkey) with ordinality as cols(attnum, ordinality) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = cols.attnum
  where c.conrelid = 'public.app_state'::regclass and c.contype = 'p'
  group by c.conname;

  if pk_name is not null and pk_columns <> array['user_id', 'key'] then
    execute format('alter table public.app_state drop constraint %I', pk_name);
    pk_name := null;
  end if;

  if pk_name is null then
    alter table public.app_state add constraint app_state_pkey primary key (user_id, key);
  end if;
end $$;

-- Add foreign keys for tables upgraded from the old single-user schema.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.days'::regclass and conname = 'days_user_id_fkey'
  ) then
    alter table public.days
      add constraint days_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass and conname = 'app_state_user_id_fkey'
  ) then
    alter table public.app_state
      add constraint app_state_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

create table if not exists activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  pillar text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  minutes int not null check (minutes >= 0),
  tag_ids text[] not null default '{}',
  note_snapshot text not null default '',
  created_at timestamptz not null default now(),
  constraint activity_sessions_ended_after_started check (ended_at >= started_at)
);

create table if not exists friendships (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists live_status (
  user_id uuid primary key references profiles(id) on delete cascade,
  pillar text,
  tag_ids text[] not null default '{}',
  shared_note text not null default '',
  is_tracking boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Add constraints that might be missing if an older Task 1 script already ran.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_display_name_not_blank'
  ) then
    alter table public.profiles
      add constraint profiles_display_name_not_blank check (length(trim(display_name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activity_sessions'::regclass and conname = 'activity_sessions_ended_after_started'
  ) then
    alter table public.activity_sessions
      add constraint activity_sessions_ended_after_started check (ended_at >= started_at);
  end if;
end $$;

-- Drop friend-read policies before the accepted-row audit. If this script is
-- being applied statement-by-statement and the audit stops, unaudited accepted
-- rows should not keep granting friend visibility.
drop policy if exists "profiles accepted friends read" on profiles;
drop policy if exists "live_status accepted friends read" on live_status;

-- Stop before trusting accepted rows that might have been created by older,
-- weaker client-side friendship policies.
do $$
declare
  accepted_friendship_count int;
  allow_existing_accepted_friendships boolean :=
    lower(coalesce(current_setting('momentum.allow_existing_accepted_friendships', true), 'false')) = 'true';
  accepted_friendships_already_audited boolean :=
    coalesce(obj_description('public.friendships'::regclass), '') like '%momentum.accepted_friendships_audited=true%';
begin
  select count(*) into accepted_friendship_count
  from public.friendships
  where status = 'accepted';

  if accepted_friendship_count > 0
    and not allow_existing_accepted_friendships
    and not accepted_friendships_already_audited then
    raise exception
      'Existing accepted friendships need audit. Review friendships rows, delete untrusted rows, then set momentum.allow_existing_accepted_friendships to true before rerunning setup.sql.';
  end if;
end $$;

comment on table friendships is 'momentum.accepted_friendships_audited=true';

-- Stop with a clear message before the normalized pair index would fail.
do $$
declare
  duplicate_pair_count int;
begin
  select count(*) into duplicate_pair_count
  from (
    select 1
    from public.friendships
    group by least(requester_id, addressee_id), greatest(requester_id, addressee_id)
    having count(*) > 1
  ) duplicate_pairs;

  if duplicate_pair_count > 0 then
    raise exception
      'Duplicate or reversed friendship rows exist. Keep only one row for each user pair, delete the extra rows, then rerun setup.sql.';
  end if;
end $$;

create index if not exists activity_sessions_user_date_idx on activity_sessions (user_id, date, started_at);
create index if not exists friendships_addressee_idx on friendships (addressee_id, status);
create unique index if not exists friendships_unique_pair_idx
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table profiles enable row level security;
alter table days enable row level security;
alter table app_state enable row level security;
alter table activity_sessions enable row level security;
alter table friendships enable row level security;
alter table live_status enable row level security;

drop policy if exists "profiles owner read write" on profiles;
create policy "profiles owner read write" on profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles accepted friends read" on profiles
  for select to authenticated
  using (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
          or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
        )
    )
  );

drop policy if exists "days owner access" on days;
create policy "days owner access" on days
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "app_state owner access" on app_state;
create policy "app_state owner access" on app_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "activity_sessions owner access" on activity_sessions;
create policy "activity_sessions owner access" on activity_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "friendships participant access" on friendships;
drop policy if exists "friendships requester creates pending" on friendships;
drop policy if exists "friendships participants read" on friendships;
drop policy if exists "friendships participants delete" on friendships;

create policy "friendships requester creates pending" on friendships
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and addressee_id <> auth.uid()
    and status = 'pending'
  );

create policy "friendships participants read" on friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "friendships participants delete" on friendships
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- v1: accepted friendships are admin-seeded/manual.
-- There is intentionally no authenticated update policy for friendships.

drop policy if exists "live_status owner write" on live_status;
create policy "live_status owner write" on live_status
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "live_status accepted friends read" on live_status
  for select to authenticated
  using (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = live_status.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = live_status.user_id)
        )
    )
  );
