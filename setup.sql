-- Momentum schema. Paste into Supabase Dashboard > SQL Editor > Run.
-- Multi-user foundation: private diary data, friend-visible live status only.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
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
  created_at timestamptz not null default now()
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

create index if not exists activity_sessions_user_date_idx on activity_sessions (user_id, date, started_at);
create index if not exists friendships_addressee_idx on friendships (addressee_id, status);

alter table profiles enable row level security;
alter table days enable row level security;
alter table app_state enable row level security;
alter table activity_sessions enable row level security;
alter table friendships enable row level security;
alter table live_status enable row level security;

drop policy if exists "authenticated full access" on days;
drop policy if exists "authenticated full access" on app_state;

drop policy if exists "profiles owner read write" on profiles;
create policy "profiles owner read write" on profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles accepted friends read" on profiles;
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
create policy "friendships participant access" on friendships
  for all to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists "live_status owner write" on live_status;
create policy "live_status owner write" on live_status
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "live_status accepted friends read" on live_status;
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
