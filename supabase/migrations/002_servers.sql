-- uazapiGO Servers (support multiple server deployments)
create table servers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  url text not null,                  -- e.g. https://smartskillshub.uazapi.com
  admin_token text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Link instances to servers
alter table instances
  add column server_id uuid references servers(id) on delete set null;

create index on instances(server_id);

-- RLS
alter table servers enable row level security;
create policy "admins_all" on servers for all to authenticated using (true) with check (true);

create trigger set_updated_at before update on servers for each row execute function update_updated_at();
