-- Admin profiles: one per auth.users row
-- Stores the uazapiGO server the admin manages
-- rollback: drop table if exists admin_profiles cascade;

create table admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  uazapi_server_url text not null default '',
  uazapi_admin_token text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table admin_profiles enable row level security;

-- Each admin can only read/write their own profile
create policy "own_profile" on admin_profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Service role can read all profiles (for internal API calls)
create policy "service_read_all" on admin_profiles
  for select to service_role
  using (true);

create trigger set_updated_at before update on admin_profiles
  for each row execute function update_updated_at();
