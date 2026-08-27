-- Migration 010: batimento do webhook
--
-- O watchdog media "tempo desde o ultimo evento `connection`" porque so esse
-- tipo era registrado em `webhook_events`. Isso confunde dois cenarios muito
-- diferentes:
--   a) o webhook esta morto (nada chega);
--   b) o webhook entrega normalmente, mas nenhuma instancia mudou de estado.
--
-- Esta tabela guarda uma unica linha com o instante da ULTIMA entrega de
-- qualquer tipo de evento, o que separa os dois casos sem inchar
-- `webhook_events` com eventos de mensagem.
--
-- rollback: drop table webhook_heartbeat;

create table if not exists webhook_heartbeat (
  id              boolean primary key default true check (id),
  last_event_at   timestamptz not null default now(),
  last_event_type text
);

comment on table webhook_heartbeat is
  'Linha unica: instante da ultima entrega de webhook de qualquer tipo. Usado pelo watchdog do monitor.';

insert into webhook_heartbeat (id, last_event_at, last_event_type)
values (true, now(), null)
on conflict (id) do nothing;

alter table webhook_heartbeat enable row level security;

create policy "admins_all" on webhook_heartbeat
  for all to authenticated using (true) with check (true);
