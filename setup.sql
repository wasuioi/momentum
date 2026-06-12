-- Momentum schema. Paste into Supabase Dashboard > SQL Editor > Run.

create table if not exists days (
  date date primary key,
  data jsonb not null default '{}'::jsonb,
  score int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists app_state (
  key text primary key,
  value jsonb -- nullable: timer key stores null when no timer runs
);

alter table days enable row level security;
alter table app_state enable row level security;

-- Single-user app: any authenticated user (only Heng has an account) gets full access.
drop policy if exists "authenticated full access" on days;
create policy "authenticated full access" on days
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on app_state;
create policy "authenticated full access" on app_state
  for all to authenticated using (true) with check (true);
