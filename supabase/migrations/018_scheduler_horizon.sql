-- ============================================================
-- Migration 018: o agendador passa a abrir execucoes que vencem nos proximos
-- segundos, para passos seguidos nao esperarem o minuto seguinte.
--
-- Problema: a passada do agendador roda a cada minuto (o cron do Cloudflare nao
-- desce disso). `open_due_group_runs()` abria so execucoes com `run_at <= now()`.
-- Um passo marcado para "10 s depois do anterior" ainda nao tinha vencido quando a
-- passada abria o anterior; so seria aberto na passada seguinte, ~1 minuto depois.
--
-- Agora o claim abre tambem as execucoes que vencem dentro do horizonte da
-- passada (o mesmo `p_horizon_seconds` que ja traz os itens proximos). Os itens
-- nascem com `not_before` no futuro proximo e a passada dorme ate la — dormir nao
-- gasta CPU. O ritmo entre duas acoes do numero continua garantido por
-- `reserve_group_instance_slot` (016), nao por este horizonte.
--
-- Recria `open_due_group_runs` com um parametro (o corpo e o da 016, mais o
-- horizonte) e `claim_group_task_items` para repassa-lo. A versao sem argumentos e
-- REMOVIDA: deixar as duas daria "function is not unique" na chamada sem argumentos.
--
-- rollback: reaplicar as definicoes de open_due_group_runs() e
--   claim_group_task_items(...) da migration 016 (e dar drop em
--   open_due_group_runs(integer) antes).
-- ============================================================

drop function if exists open_due_group_runs();

create or replace function open_due_group_runs(p_horizon_seconds integer default 0)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  abertas integer := 0;
  r       record;
  v_ate   timestamptz := now() + (greatest(p_horizon_seconds, 0) || ' seconds')::interval;
begin
  update group_task_runs run
  set status         = 'failed',
      blocked_reason = 'Perdeu o horario: o envio estava marcado para ' ||
                       to_char(run.run_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') ||
                       ' e nao rodou ate 60 minutos depois.'
  from group_tasks t
  where t.id = run.task_id
    and run.status = 'scheduled'
    and run.run_at < now() - interval '60 minutes'
    and t.status not in ('paused', 'canceled', 'blocked');

  for r in
    select run.id, run.run_at,
           coalesce(run.resolved_jids, t.target_jids) as jids,
           t.spacing_seconds, t.spacing_jitter_pct
    from group_task_runs run
    join group_tasks t on t.id = run.task_id
    where run.status = 'scheduled'
      and run.run_at <= v_ate
      and t.status not in ('paused', 'canceled', 'blocked')
      and not exists (
        select 1
        from group_task_runs r2
        join group_tasks t2 on t2.id = r2.task_id
        where t2.instance_id = t.instance_id
          and t2.status = 'running'
          and r2.status = 'running'
          and coalesce(r2.last_action_at, r2.opened_at) > now() - interval '10 minutes'
      )
    order by run.run_at
    limit 50
    for update of run skip locked
  loop
    insert into group_task_items (run_id, group_jid, seq, not_before)
    select r.id,
           jid,
           ord - 1,
           r.run_at + ((ord - 1) * r.spacing_seconds
                       * (1 + ((random() * 2 - 1) * r.spacing_jitter_pct / 100.0)))
                      * interval '1 second'
    from unnest(r.jids) with ordinality as alvo(jid, ord)
    on conflict (run_id, group_jid) do nothing;

    update group_task_runs
    set status        = 'open',
        opened_at     = now(),
        resolved_jids = coalesce(resolved_jids, r.jids),
        total         = (select count(*) from group_task_items where run_id = r.id)
    where id = r.id;

    abertas := abertas + 1;
  end loop;

  return abertas;
end;
$$;

comment on function open_due_group_runs(integer) is
  'Materializa os items das ocorrencias vencidas ou que vencem em p_horizon_seconds. Idempotente via unique (run_id, group_jid).';

drop function if exists claim_group_task_items(integer, integer, integer);

create function claim_group_task_items(
  p_limit           integer default 5,
  p_lease_minutes   integer default 5,
  p_horizon_seconds integer default 50
)
returns table (
  item_id            bigint,
  run_id             uuid,
  task_id            uuid,
  group_jid          text,
  seq                integer,
  not_before         timestamptz,
  kind               text,
  payload            jsonb,
  instance_id        uuid,
  uazapi_token       text,
  server_url         text,
  admin_token        text,
  spacing_seconds    integer,
  spacing_jitter_pct integer,
  mention_all        boolean,
  owner_is_admin     boolean,
  owner_can_send     boolean,
  group_name         text,
  instance_status    text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform open_due_group_runs(p_horizon_seconds);

  return query
  with alvo as (
    select i.id
    from group_task_items i
    join group_task_runs r on r.id = i.run_id
    join group_tasks     t on t.id = r.task_id
    where i.status = 'pending'
      and i.not_before <= now() + (greatest(p_horizon_seconds, 0) || ' seconds')::interval
      and r.status in ('open', 'running')
      and t.status in ('scheduled', 'running')
    order by i.not_before
    limit greatest(p_limit, 0)
    for update of i skip locked
  ), reivindicados as (
    update group_task_items i
    set status     = 'running',
        claimed_at = now(),
        attempts   = i.attempts + 1
    from alvo
    where i.id = alvo.id
    returning i.*
  )
  select c.id, c.run_id, r.task_id, c.group_jid, c.seq, c.not_before,
         s.kind, s.payload,
         t.instance_id, inst.uazapi_token,
         srv.url, srv.admin_token,
         t.spacing_seconds, t.spacing_jitter_pct, t.mention_all,
         coalesce(gc.owner_is_admin, false),
         coalesce(gc.owner_can_send, true),
         gc.name,
         inst.status::text
  from reivindicados c
  join group_task_runs  r    on r.id   = c.run_id
  join group_task_steps s    on s.id   = r.step_id
  join group_tasks      t    on t.id   = r.task_id
  join instances        inst on inst.id = t.instance_id
  left join servers     srv  on srv.id  = inst.server_id
  left join group_cache gc   on gc.instance_id = t.instance_id
                            and gc.group_jid   = c.group_jid
  order by c.not_before;

  perform p_lease_minutes;
end;
$$;

comment on function claim_group_task_items(integer, integer, integer) is
  'Materializa ocorrencias vencidas (ou que vencem no horizonte) e reivindica ate p_limit items com lease, ja com credenciais, portoes de admin do grupo e estado da instancia.';

revoke execute on function open_due_group_runs(integer)                          from public, anon, authenticated;
revoke execute on function claim_group_task_items(integer, integer, integer)     from public, anon, authenticated;
grant  execute on function open_due_group_runs(integer)                          to service_role;
grant  execute on function claim_group_task_items(integer, integer, integer)     to service_role;
