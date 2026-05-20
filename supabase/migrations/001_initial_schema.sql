-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Clients (end users, no login required)
create table clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text,
  phones text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- WhatsApp instances
create table instances (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete set null,
  uazapi_token text not null unique,
  name text not null,
  status text not null default 'disconnected' check (status in ('connected','disconnected','connecting')),
  phone_connected text,
  profile_name text,
  profile_picture text,
  last_disconnected_at timestamptz,
  alert_channel text default 'email' check (alert_channel in ('email','whatsapp','n8n','none')),
  alert_config jsonb default '{}',
  silence_start int default 23,  -- hour 0-23
  silence_end int default 7,     -- hour 0-23
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhook events log
create table webhook_events (
  id uuid primary key default uuid_generate_v4(),
  instance_id uuid references instances(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- Reconnection tokens (sent via email/WhatsApp to clients)
create table reconnect_tokens (
  id uuid primary key default uuid_generate_v4(),
  instance_id uuid not null references instances(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Notifications log
create table notifications_log (
  id uuid primary key default uuid_generate_v4(),
  instance_id uuid references instances(id) on delete cascade,
  channel text not null,
  recipient text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes
create index on instances(client_id);
create index on instances(status);
create index on webhook_events(instance_id, received_at desc);
create index on reconnect_tokens(token) where used_at is null;
create index on notifications_log(instance_id, created_at desc);

-- RLS: only authenticated admins can access all tables
alter table clients enable row level security;
alter table instances enable row level security;
alter table webhook_events enable row level security;
alter table reconnect_tokens enable row level security;
alter table notifications_log enable row level security;

-- Admin policy (service_role bypasses RLS; authenticated users = admins)
create policy "admins_all" on clients for all to authenticated using (true) with check (true);
create policy "admins_all" on instances for all to authenticated using (true) with check (true);
create policy "admins_all" on webhook_events for all to authenticated using (true) with check (true);
create policy "admins_all" on reconnect_tokens for all to authenticated using (true) with check (true);
create policy "admins_all" on notifications_log for all to authenticated using (true) with check (true);

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger set_updated_at before update on clients for each row execute function update_updated_at();
create trigger set_updated_at before update on instances for each row execute function update_updated_at();
