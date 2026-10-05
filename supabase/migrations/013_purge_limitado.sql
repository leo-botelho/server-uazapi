-- ============================================================
-- Migration 013: limpeza de logs em lotes + indices do watchdog
--
-- Motivo: o Worker do Cloudflare passou a estourar o limite de CPU a cada
-- execucao do monitor (a cada 2 min). O monitor apagava os registros antigos
-- com `delete ... .select('id')`, ou seja, o banco devolvia a lista inteira de
-- ids apagados e o Worker gastava CPU so para montar e descartar esse JSON.
-- Com backlog grande, o DELETE tambem podia estourar o statement_timeout do
-- Supabase, nunca terminar e ser repetido a cada 2 minutos para sempre.
--
-- Estas funcoes apagam em lotes e devolvem apenas a QUANTIDADE.
--
-- rollback:
--   drop function if exists purge_webhook_events(timestamptz, integer);
--   drop function if exists purge_reconnect_tokens(timestamptz, integer);
--   drop index if exists idx_webhook_events_received_at;
--   drop index if exists idx_webhook_events_orfaos;
-- ============================================================

-- `webhook_events` so tinha indice por (instance_id, received_at). O watchdog
-- pergunta "qual o evento mais recente de todos" e a limpeza varre por data:
-- as duas precisam de indice por received_at.
create index if not exists idx_webhook_events_received_at
  on webhook_events (received_at desc);

-- Eventos que chegaram sem instancia dona (token divergente). Indice parcial:
-- so as linhas problematicas entram, entao fica pequeno.
create index if not exists idx_webhook_events_orfaos
  on webhook_events (received_at desc)
  where instance_id is null;

create or replace function purge_webhook_events(p_cutoff timestamptz, p_limit integer default 2000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  removidos integer;
begin
  with alvo as (
    select id
    from webhook_events
    where received_at < p_cutoff
    order by received_at
    limit greatest(p_limit, 0)
  ), apagados as (
    delete from webhook_events w
    using alvo
    where w.id = alvo.id
    returning 1
  )
  select count(*) into removidos from apagados;

  return removidos;
end;
$$;

comment on function purge_webhook_events(timestamptz, integer) is
  'Apaga ate p_limit eventos anteriores a p_cutoff e devolve quantos foram apagados. Em lotes para nao estourar o statement_timeout nem a CPU do Worker.';

create or replace function purge_reconnect_tokens(p_cutoff timestamptz, p_limit integer default 2000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  removidos integer;
begin
  with alvo as (
    select id
    from reconnect_tokens
    where expires_at < p_cutoff
    order by expires_at
    limit greatest(p_limit, 0)
  ), apagados as (
    delete from reconnect_tokens t
    using alvo
    where t.id = alvo.id
    returning 1
  )
  select count(*) into removidos from apagados;

  return removidos;
end;
$$;

-- So o servidor (service role) limpa: nada disso passa pela API publica.
revoke execute on function purge_webhook_events(timestamptz, integer)   from public, anon, authenticated;
revoke execute on function purge_reconnect_tokens(timestamptz, integer) from public, anon, authenticated;
grant  execute on function purge_webhook_events(timestamptz, integer)   to service_role;
grant  execute on function purge_reconnect_tokens(timestamptz, integer) to service_role;
