-- ============================================================
-- Migration 016: agendador do modulo de grupos
--
-- A 015 criou o modelo (tarefa > passo > ocorrencia > item) e as funcoes de
-- claim. Esta migration acrescenta o que o AGENDADOR precisa para rodar sem
-- supervisao — e, principalmente, o que impede ele de fazer estrago quando
-- ninguem esta olhando:
--
--   1. Cadencia por NUMERO, nao por ocorrencia. Duas tarefas agendadas para
--      a mesma hora na mesma instancia dobrariam o ritmo real de mensagens sem
--      nenhuma violar a propria regra. `group_instance_pace` guarda o instante
--      do ultimo envio de cada instancia e `reserve_group_instance_slot()` o
--      reserva de forma atomica.
--
--   2. Nada de reenvio as cegas. Se uma passada morre DEPOIS de chamar a API e
--      ANTES de gravar o resultado, o item volta do lease sem saber se a
--      mensagem saiu. A 015 o reenviaria. Agora `begin_group_item_send()` grava
--      `executed_at` ANTES de enviar, e `reclaim_stale_group_items()` marca como
--      falha "pode ter sido entregue" tudo que tinha `executed_at` — nunca
--      reenvia. Item que so foi reivindicado e nao chegou a enviar volta a fila.
--
--   3. Horario perdido nao dispara depois. Uma ocorrencia que passou mais de
--      60 minutos do horario (cron parado, tarefa pausada) vira `failed` com
--      motivo, em vez de mandar uma promocao velha fora de hora.
--
--   4. Pausar / retomar / cancelar / repetir falhas / bloquear sao funcoes
--      atomicas, para a rota nao precisar de varias idas ao banco.
--
-- Para o claim ganhar a coluna `instance_status`, a funcao e RECRIADA (o tipo
-- de retorno de uma funcao nao muda com `create or replace`).
--
-- rollback:
--   drop trigger if exists trg_group_task_runs_task_rollup on group_task_runs;
--   drop function if exists group_task_runs_task_rollup();
--   drop function if exists retry_failed_group_items(uuid, boolean);
--   drop function if exists resume_group_task(uuid);
--   drop function if exists cancel_group_task(uuid);
--   drop function if exists block_group_instance_tasks(uuid, text);
--   drop function if exists release_group_task_item(bigint, timestamptz);
--   drop function if exists begin_group_item_send(bigint);
--   drop function if exists reserve_group_instance_slot(uuid, integer);
--   drop table if exists group_instance_pace;
--   -- e reaplicar as definicoes de claim_group_task_items, open_due_group_runs
--   -- e reclaim_stale_group_items da migration 015.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Cadencia por instancia
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists group_instance_pace (
  instance_id    uuid primary key references instances(id) on delete cascade,
  last_action_at timestamptz not null
);

-- Devolve 0 quando reservou o instante (pode enviar AGORA) ou quantos
-- milissegundos faltam para o proximo envio ser permitido. Uma instrucao so:
-- duas passadas simultaneas disputam a mesma linha e so uma passa.
create or replace function reserve_group_instance_slot(p_instance uuid, p_min_ms integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_piso  interval := greatest(p_min_ms, 0) * interval '1 millisecond';
  v_agora timestamptz := clock_timestamp();
  v_gravado timestamptz;
  v_falta integer;
begin
  insert into group_instance_pace (instance_id, last_action_at)
  values (p_instance, v_agora)
  on conflict (instance_id) do update
    set last_action_at = excluded.last_action_at
    where group_instance_pace.last_action_at <= v_agora - v_piso
  returning last_action_at into v_gravado;

  if v_gravado is not null then
    return 0;
  end if;

  select greatest(1, ceil(extract(epoch from (p.last_action_at + v_piso - v_agora)) * 1000))::integer
    into v_falta
  from group_instance_pace p
  where p.instance_id = p_instance;

  return coalesce(v_falta, 1);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- O portao imediatamente antes de enviar
--
-- Faz tres coisas numa ida so: confere que o item ainda e nosso, confere que a
-- tarefa nao foi pausada/cancelada/bloqueada entre o claim e agora (a passada
-- pode ter dormido ate 50 s), e marca `executed_at`. Esse carimbo e o que
-- impede o reenvio cego no lease (ver cabecalho).
--
-- Retorna: 'ok' | 'perdido' (nao e mais nosso) | 'parado' (tarefa pausada ou
-- bloqueada: o item volta para a fila) | 'cancelado'.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function begin_group_item_send(p_id bigint)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item   group_task_items%rowtype;
  v_tarefa text;
  v_run    text;
begin
  select * into v_item from group_task_items where id = p_id for update;

  if not found or v_item.status <> 'running' or v_item.executed_at is not null then
    return 'perdido';
  end if;

  select t.status, r.status into v_tarefa, v_run
  from group_task_runs r
  join group_tasks t on t.id = r.task_id
  where r.id = v_item.run_id;

  if v_tarefa = 'canceled' or v_run = 'canceled' then
    update group_task_items set status = 'canceled', claimed_at = null where id = p_id;
    return 'cancelado';
  end if;

  if v_tarefa not in ('scheduled', 'running') or v_run not in ('open', 'running') then
    update group_task_items
    set status = 'pending', claimed_at = null, attempts = greatest(attempts - 1, 0)
    where id = p_id;
    return 'parado';
  end if;

  update group_task_items set executed_at = now() where id = p_id;
  return 'ok';
end;
$$;

-- Devolve a fila um item que foi reivindicado mas NAO chegou a ser enviado.
create or replace function release_group_task_item(p_id bigint, p_not_before timestamptz)
returns void
language sql
security invoker
set search_path = public
as $$
  update group_task_items
  set status     = 'pending',
      claimed_at = null,
      attempts   = greatest(attempts - 1, 0),
      not_before = greatest(not_before, p_not_before)
  where id = p_id
    and status = 'running'
    and executed_at is null;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lease vencido: nunca reenvia o que pode ter saido
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function reclaim_stale_group_items(p_minutes integer default 5)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  devolvidos integer;
begin
  with voltando as (
    update group_task_items
    set status = case
          when executed_at is not null then 'failed'
          when attempts >= 3           then 'failed'
          else 'pending'
        end,
        error = case
          when executed_at is not null
            then 'Interrompido durante o envio: a mensagem pode ter sido entregue. Confira o grupo antes de repetir.'
          when attempts >= 3
            then coalesce(error, 'abandonado apos 3 tentativas')
          else error
        end,
        response = case
          when executed_at is not null then coalesce(response, '{}'::jsonb) || '{"incerto": true}'::jsonb
          else response
        end,
        claimed_at = null
    where status = 'running'
      and claimed_at < now() - (greatest(p_minutes, 1) || ' minutes')::interval
    returning 1
  )
  select count(*) into devolvidos from voltando;

  return devolvidos;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Materializacao das ocorrencias vencidas
--
-- Duas mudancas em relacao a 015:
--   * ocorrencia que perdeu o horario por mais de 60 min vira `failed`;
--   * nao abre ocorrencia numa instancia que tem um envio pelo NAVEGADOR em
--     andamento (tarefa `running` com atividade recente) — os dois motores
--     juntos dobrariam a cadencia real.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function open_due_group_runs()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  abertas integer := 0;
  r       record;
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
      and run.run_at <= now()
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

-- ─────────────────────────────────────────────────────────────────────────────
-- O claim, agora com o estado da instancia
--
-- `instance_status` evita uma chamada a uazapiGO so para descobrir que o numero
-- esta desconectado: o monitor ja mantem esse valor atualizado a cada 2 min.
-- ─────────────────────────────────────────────────────────────────────────────
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
  perform open_due_group_runs();

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

  -- O lease e devolvido por reclaim_stale_group_items() com o mesmo numero de
  -- minutos; o parametro fica aqui por simetria com o chamador.
  perform p_lease_minutes;
end;
$$;

comment on function claim_group_task_items(integer, integer, integer) is
  'Materializa ocorrencias vencidas e reivindica ate p_limit items com lease, ja com credenciais, portoes de admin do grupo e estado da instancia.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Bloqueio por restricao do WhatsApp (erro 463)
--
-- A restricao e do NUMERO, nao de uma tarefa: bloqueia todas as tarefas
-- agendadas da instancia. Os itens pendentes continuam na fila — quem retoma,
-- depois que a restricao acabar, e o operador.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function block_group_instance_tasks(p_instance uuid, p_reason text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  bloqueadas integer;
begin
  with b as (
    update group_tasks
    set status = 'blocked', blocked_reason = p_reason, updated_at = now()
    where instance_id = p_instance
      and status in ('scheduled', 'running')
    returning id
  ), runs as (
    update group_task_runs r
    set status = 'blocked_by_wa_limits', blocked_reason = p_reason
    from b
    where r.task_id = b.id
      and r.status in ('open', 'running')
    returning 1
  )
  select count(*) into bloqueadas from b;

  return bloqueadas;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cancelar
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function cancel_group_task(p_task uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  cancelados integer;
begin
  update group_tasks
  set status = 'canceled', updated_at = now()
  where id = p_task and status not in ('done', 'canceled');

  -- As ocorrencias primeiro: o rollup preserva o status `canceled` da ocorrencia
  -- quando os items mudam logo em seguida.
  update group_task_runs
  set status = 'canceled'
  where task_id = p_task
    and status in ('scheduled', 'open', 'running', 'paused', 'blocked_by_wa_limits');

  with c as (
    update group_task_items i
    set status = 'canceled', claimed_at = null
    from group_task_runs r
    where r.id = i.run_id
      and r.task_id = p_task
      and (i.status = 'pending' or (i.status = 'running' and i.executed_at is null))
    returning 1
  )
  select count(*) into cancelados from c;

  return cancelados;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retomar (tarefa pausada ou bloqueada)
--
-- Reespaca os pendentes a partir de AGORA. Sem isso, tudo que venceu durante a
-- pausa ficaria atrasado e sairia em rajada logo que a tarefa voltasse.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function resume_group_task(p_task uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  reagendados integer;
begin
  update group_tasks
  set status = 'scheduled', blocked_reason = null, updated_at = now()
  where id = p_task and status in ('paused', 'blocked');

  if not found then
    return 0;
  end if;

  update group_task_runs
  set status = 'open', blocked_reason = null
  where task_id = p_task and status in ('paused', 'blocked_by_wa_limits');

  with ordem as (
    select i.id,
           row_number() over (partition by i.run_id order by i.seq) - 1 as pos,
           t.spacing_seconds, t.spacing_jitter_pct
    from group_task_items i
    join group_task_runs r on r.id = i.run_id
    join group_tasks     t on t.id = r.task_id
    where r.task_id = p_task
      and r.status in ('open', 'running')
      and i.status = 'pending'
  ), mexidos as (
    update group_task_items i
    set not_before = now() + (o.pos * o.spacing_seconds
                              * (1 + ((random() * 2 - 1) * o.spacing_jitter_pct / 100.0)))
                             * interval '1 second'
    from ordem o
    where i.id = o.id
    returning 1
  )
  select count(*) into reagendados from mexidos;

  return reagendados;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Repetir as falhas de uma ocorrencia
--
-- Por padrao NAO repete o que ficou "incerto" (timeout ou passada interrompida):
-- a mensagem pode ter sido entregue, e repetir seria mandar duas vezes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function retry_failed_group_items(p_run uuid, p_include_uncertain boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  repetidos integer;
  v_task    uuid;
begin
  select task_id into v_task from group_task_runs where id = p_run;
  if v_task is null then
    return 0;
  end if;

  with ordem as (
    select i.id,
           row_number() over (order by i.seq) - 1 as pos,
           t.spacing_seconds, t.spacing_jitter_pct
    from group_task_items i
    join group_task_runs r on r.id = i.run_id
    join group_tasks     t on t.id = r.task_id
    where i.run_id = p_run
      and i.status = 'failed'
      and (p_include_uncertain or coalesce((i.response ->> 'incerto')::boolean, false) = false)
  ), mexidos as (
    update group_task_items i
    set status      = 'pending',
        attempts    = 0,
        claimed_at  = null,
        executed_at = null,
        error       = null,
        response    = null,
        not_before  = now() + (o.pos * o.spacing_seconds
                               * (1 + ((random() * 2 - 1) * o.spacing_jitter_pct / 100.0)))
                              * interval '1 second'
    from ordem o
    where i.id = o.id
    returning 1
  )
  select count(*) into repetidos from mexidos;

  if repetidos > 0 then
    update group_task_runs set status = 'open', blocked_reason = null
    where id = p_run and status in ('done', 'failed');

    update group_tasks set status = 'scheduled', updated_at = now()
    where id = v_task and status = 'done';
  end if;

  return repetidos;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A tarefa termina quando todas as ocorrencias terminam
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function group_task_runs_task_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('done', 'failed', 'canceled') then
    update group_tasks t
    set status = 'done', updated_at = now()
    where t.id = new.task_id
      and t.status in ('scheduled', 'running')
      and not exists (
        select 1 from group_task_runs r
        where r.task_id = new.task_id
          and r.status in ('scheduled', 'open', 'running', 'paused', 'blocked_by_wa_limits')
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_group_task_runs_task_rollup on group_task_runs;
create trigger trg_group_task_runs_task_rollup
  after update on group_task_runs
  for each row execute function group_task_runs_task_rollup();

-- ─────────────────────────────────────────────────────────────────────────────
-- Travas de acesso (mesmo modelo das migrations 011/012/013/015)
-- ─────────────────────────────────────────────────────────────────────────────
alter table group_instance_pace enable row level security;
revoke all on table group_instance_pace from anon, authenticated;

revoke execute on function reserve_group_instance_slot(uuid, integer)            from public, anon, authenticated;
revoke execute on function begin_group_item_send(bigint)                         from public, anon, authenticated;
revoke execute on function release_group_task_item(bigint, timestamptz)          from public, anon, authenticated;
revoke execute on function reclaim_stale_group_items(integer)                    from public, anon, authenticated;
revoke execute on function open_due_group_runs()                                 from public, anon, authenticated;
revoke execute on function claim_group_task_items(integer, integer, integer)     from public, anon, authenticated;
revoke execute on function block_group_instance_tasks(uuid, text)                from public, anon, authenticated;
revoke execute on function cancel_group_task(uuid)                               from public, anon, authenticated;
revoke execute on function resume_group_task(uuid)                               from public, anon, authenticated;
revoke execute on function retry_failed_group_items(uuid, boolean)               from public, anon, authenticated;

grant execute on function reserve_group_instance_slot(uuid, integer)             to service_role;
grant execute on function begin_group_item_send(bigint)                          to service_role;
grant execute on function release_group_task_item(bigint, timestamptz)           to service_role;
grant execute on function reclaim_stale_group_items(integer)                     to service_role;
grant execute on function open_due_group_runs()                                  to service_role;
grant execute on function claim_group_task_items(integer, integer, integer)      to service_role;
grant execute on function block_group_instance_tasks(uuid, text)                 to service_role;
grant execute on function cancel_group_task(uuid)                                to service_role;
grant execute on function resume_group_task(uuid)                                to service_role;
grant execute on function retry_failed_group_items(uuid, boolean)                to service_role;
