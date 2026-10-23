-- ============================================================
-- Migration 015: modulo de gerenciamento de grupos
--
-- O painel so monitorava instancias. Esta migration cria a base para operar os
-- grupos de cada instancia: listar (com cache), disparar mensagem em massa com
-- intervalo entre cada grupo, alterar nome/foto/descricao, gerenciar
-- participantes — tudo isso agendavel para uma ou varias datas.
--
-- Modelo em quatro niveis, que e o que faz "multi-tarefa + varias datas +
-- sequencia de mensagens" caber num desenho so:
--
--   group_tasks          a campanha (instancia, alvos, espacamento, seguranca)
--     group_task_steps     passos ordenados — cada um com seu tipo e agenda
--       group_task_runs      uma linha por ocorrencia (passo x data/hora)
--         group_task_items     uma linha por (ocorrencia x grupo) — A FILA
--
-- Os items sao materializados TARDE, quando a ocorrencia vence, por
-- open_due_group_runs(). Assim editar uma tarefa agendada e um UPDATE simples
-- sem refazer fan-out, e ocorrencias distantes nao ocupam linha nenhuma.
--
-- rollback:
--   drop function if exists claim_group_task_items(integer, integer, integer);
--   drop function if exists open_due_group_runs();
--   drop function if exists reclaim_stale_group_items(integer);
--   drop function if exists purge_group_history(timestamptz, integer);
--   drop function if exists refresh_group_cache_upsert(uuid, jsonb);
--   drop trigger if exists trg_group_task_items_rollup on group_task_items;
--   drop function if exists group_task_items_rollup();
--   drop table if exists group_task_items, group_task_runs, group_task_steps,
--                        group_tasks, group_media, group_cache;
--   delete from storage.buckets where id = 'group-assets';
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Cache dos grupos
--
-- Existe porque listar grupos na uazapiGO e caro (chamada remota de ate 30 s
-- com muitos grupos) e a tela precisa de busca e paginacao instantaneas.
--
-- ⚠️ NAO e alimentado por webhook. O evento `groups` so existe no webhook
-- GLOBAL, e assinar qualquer coisa no webhook POR INSTANCIA quebraria os
-- agentes de IA no n8n (ver lib/uazapi/client.ts). A atualizacao vem de tres
-- lugares: TTL na carga da pagina, botao explicito, e o objeto `group` que toda
-- mutacao da uazapiGO devolve.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists group_cache (
  instance_id   uuid        not null references instances(id) on delete cascade,
  group_jid     text        not null,

  name          text,
  topic         text,                      -- Group.Topic = descricao do grupo
  owner_jid     text,
  image_url     text,                      -- vem de /chat/find ou /chat/details

  -- Quantidade, nunca a lista. O array de participantes e dado pessoal (LGPD)
  -- e inflaria o cache — processa-lo a cada listagem foi exatamente o tipo de
  -- trabalho que estourou a CPU do Worker no monitor.
  participant_count int,

  -- Os dois portoes do modulo. `owner_is_admin` libera qualquer edicao;
  -- `owner_can_send` libera envio (grupo so-admin onde nao somos admin).
  owner_is_admin boolean    not null default false,
  owner_can_send boolean    not null default true,

  is_announce               boolean,
  is_locked                 boolean,
  is_parent                 boolean,       -- e uma comunidade
  is_join_approval_required boolean,
  member_add_mode           text,          -- admin_add | all_member_add
  is_ephemeral              boolean,
  disappearing_timer        integer,
  linked_parent_jid         text,
  addressing_mode           text,          -- pn | lid

  invite_link   text,
  group_created timestamptz,

  raw           jsonb,                     -- Group SEM Participants[]
  fetched_at    timestamptz not null default now(),

  primary key (instance_id, group_jid)
);

create index if not exists idx_group_cache_nome
  on group_cache (instance_id, name);

-- Teste de TTL: "o cache desta instancia esta velho?"
create index if not exists idx_group_cache_fetched
  on group_cache (instance_id, fetched_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Arquivos enviados pelo painel (foto de grupo, midia de campanha, exports)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists group_media (
  id          uuid primary key default gen_random_uuid(),
  instance_id uuid references instances(id) on delete set null,
  bucket      text not null default 'group-assets',
  path        text not null unique,
  public_url  text not null,
  mime        text not null,
  bytes       integer not null,
  -- Informados pelo cliente DEPOIS do redimensionamento. O servidor nao decodifica
  -- a imagem de proposito: decodificar e trabalho pesado de CPU no Worker.
  width       integer,
  height      integer,
  purpose     text not null check (purpose in ('group_image', 'message_media', 'export')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- A campanha
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists group_tasks (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid not null references instances(id) on delete cascade,
  name               text not null,
  target_jids        text[] not null,

  -- Segundos entre um grupo e o proximo. Essa lentidao e o recurso, nao a
  -- limitacao: 50 mencoes a todos em dez minutos e como um numero e banido.
  spacing_seconds    integer not null default 60 check (spacing_seconds >= 5),
  -- Cadencia metronomica e assinatura de robo. A uazapiGO expoe delayMin/delayMax
  -- no proprio motor dela pelo mesmo motivo.
  spacing_jitter_pct integer not null default 20 check (spacing_jitter_pct between 0 and 50),

  mention_all        boolean not null default false,
  starts_at          timestamptz,          -- ancora dos passos com offset

  status             text not null default 'draft'
    check (status in ('draft','scheduled','running','paused','done','canceled','blocked')),
  blocked_reason     text,
  wa_limits_snapshot jsonb,                -- pre-voo de wa_messages_limits

  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A trava mora aqui, nao so na tela: marcar todos exige 60 s entre grupos.
  -- Uma linha que viole isso nao consegue existir, venha de onde vier.
  constraint group_tasks_mention_all_spacing
    check (not mention_all or spacing_seconds >= 60)
);

create index if not exists idx_group_tasks_instancia
  on group_tasks (instance_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Os passos
--
-- E este nivel que permite "alteracoes diferentes e mensagens diferentes em
-- dias e horarios diferentes". Sem ele daria para expressar "a mesma mensagem
-- em N datas", mas nao "N mensagens diferentes em offsets relativos".
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists group_task_steps (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references group_tasks(id) on delete cascade,
  step_order     integer not null,

  kind           text not null check (kind in (
    'send_text', 'send_media', 'send_buttons', 'send_poll',
    'update_name', 'update_description', 'update_image',
    'update_announce', 'update_locked', 'update_join_approval',
    'update_member_add_mode', 'update_ephemeral',
    'participants_add', 'participants_remove',
    'participants_promote', 'participants_demote',
    'reset_invite', 'leave', 'export_participants'
  )),
  payload        jsonb not null,

  -- absolute: uma ocorrencia por data/hora em absolute_ats
  -- offset:   uma ocorrencia em group_tasks.starts_at + offset_minutes (drip)
  schedule_mode  text not null check (schedule_mode in ('absolute','offset')),
  absolute_ats   timestamptz[],
  offset_minutes integer,

  recurrence     jsonb,                    -- reservado; v1 nao usa

  unique (task_id, step_order),
  constraint group_task_steps_agenda check (
    (schedule_mode = 'absolute' and absolute_ats   is not null and array_length(absolute_ats, 1) > 0)
    or
    (schedule_mode = 'offset'   and offset_minutes is not null)
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- As ocorrencias
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists group_task_runs (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references group_tasks(id) on delete cascade,
  step_id        uuid not null references group_task_steps(id) on delete cascade,
  run_at         timestamptz not null,

  -- Fotografia dos alvos no momento da abertura: editar a tarefa depois nao
  -- reescreve o historico do que ja rodou.
  resolved_jids  text[],
  opened_at      timestamptz,

  status         text not null default 'scheduled'
    check (status in ('scheduled','open','running','paused','done','failed','canceled','blocked_by_wa_limits')),
  last_action_at timestamptz,              -- reforco do espacamento entre passadas

  total          integer not null default 0,
  succeeded      integer not null default 0,
  failed         integer not null default 0,
  blocked_reason text,

  -- Idempotencia: materializar duas vezes a mesma ocorrencia e impossivel.
  unique (step_id, run_at)
);

-- A consulta do agendador.
create index if not exists idx_group_task_runs_fila
  on group_task_runs (status, run_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- A fila de trabalho
--
-- ⚠️ NAO existe flag de "enviado" no nivel do lote. Cada item e individualmente
-- terminal, com lease proprio. E isso que faz uma passada interrompida no meio
-- (deploy, timeout, eviction do Worker) nao duplicar envio quando os items
-- forem reivindicados de novo.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists group_task_items (
  id          bigserial primary key,
  run_id      uuid not null references group_task_runs(id) on delete cascade,
  group_jid   text not null,
  seq         integer not null,            -- posicao na fila, base 0

  -- run_at + seq * spacing (com jitter). E daqui que vem o intervalo entre
  -- grupos, inclusive ENTRE passadas do cron — nao de dormir um minuto inteiro.
  not_before  timestamptz not null,

  status      text not null default 'pending'
    check (status in ('pending','running','sent','failed','skipped','canceled')),
  attempts    integer not null default 0,
  claimed_at  timestamptz,                 -- LEASE
  executed_at timestamptz,
  error       text,
  response    jsonb,                       -- messageid / needs_refresh / groupUpdated[]

  unique (run_id, group_jid)
);

-- A consulta de claim.
create index if not exists idx_group_task_items_fila
  on group_task_items (status, not_before);

-- Recuperacao de lease vencido.
create index if not exists idx_group_task_items_lease
  on group_task_items (claimed_at)
  where status = 'running';

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollup do progresso
--
-- A contagem sobe por trigger para a tela ler UMA linha (a ocorrencia) em vez
-- de contar items. Progresso ao vivo sem custo de CPU no Worker.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function group_task_items_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    update group_task_runs r
    set succeeded = (select count(*) from group_task_items i
                      where i.run_id = new.run_id and i.status = 'sent'),
        failed    = (select count(*) from group_task_items i
                      where i.run_id = new.run_id and i.status in ('failed','skipped')),
        status    = case
          when r.status in ('canceled','paused','blocked_by_wa_limits') then r.status
          when not exists (select 1 from group_task_items i
                            where i.run_id = new.run_id
                              and i.status in ('pending','running')) then 'done'
          else 'running'
        end
    where r.id = new.run_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_group_task_items_rollup on group_task_items;
create trigger trg_group_task_items_rollup
  after update on group_task_items
  for each row execute function group_task_items_rollup();

-- ─────────────────────────────────────────────────────────────────────────────
-- Materializacao das ocorrencias vencidas
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
  for r in
    select run.id, run.run_at,
           coalesce(run.resolved_jids, t.target_jids) as jids,
           t.spacing_seconds, t.spacing_jitter_pct
    from group_task_runs run
    join group_tasks t on t.id = run.task_id
    where run.status = 'scheduled'
      and run.run_at <= now()
      and t.status not in ('paused','canceled','blocked')
    order by run.run_at
    limit 50
    for update of run skip locked
  loop
    insert into group_task_items (run_id, group_jid, seq, not_before)
    select r.id,
           jid,
           ord - 1,
           -- O jitter desloca cada posicao dentro de ±jitter_pct do espacamento.
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

comment on function open_due_group_runs() is
  'Materializa os items das ocorrencias vencidas, espalhando not_before pelo espacamento da tarefa. Idempotente via unique (run_id, group_jid).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Devolve items cujo lease venceu
--
-- Uma passada pode morrer no meio (deploy, abort, eviction). Os items ficam
-- `running` com claimed_at velho; aqui eles voltam para a fila.
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
    set status     = case when attempts >= 3 then 'failed' else 'pending' end,
        error      = case when attempts >= 3
                          then coalesce(error, 'abandonado apos 3 tentativas') end,
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
-- O claim
--
-- UMA ida ao banco que ja devolve credenciais e portoes, para o Worker nao
-- precisar de segunda consulta nem resolver servidor/token por conta propria.
--
-- p_horizon_seconds: alem dos items ja vencidos, traz os que vencem dentro do
-- orcamento da passada — e assim que um espacamento de 10 s rende varios
-- envios numa passada so, com a rota dormindo entre eles (dormir nao gasta CPU
-- no Cloudflare: o limite e de CPU, nao de tempo de parede).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function claim_group_task_items(
  p_limit           integer default 12,
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
  group_name         text
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
      and r.status in ('open','running')
      and t.status not in ('paused','canceled','blocked')
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
         gc.name
  from reivindicados c
  join group_task_runs  r    on r.id   = c.run_id
  join group_task_steps s    on s.id   = r.step_id
  join group_tasks      t    on t.id   = r.task_id
  join instances        inst on inst.id = t.instance_id
  left join servers     srv  on srv.id  = inst.server_id
  left join group_cache gc   on gc.instance_id = t.instance_id
                            and gc.group_jid   = c.group_jid
  order by c.not_before;

  -- Lease: quem nao for concluido dentro de p_lease_minutes volta para a fila
  -- via reclaim_stale_group_items(). O parametro fica aqui por simetria com o
  -- chamador, que usa o mesmo numero nas duas funcoes.
  perform p_lease_minutes;
end;
$$;

comment on function claim_group_task_items(integer, integer, integer) is
  'Materializa ocorrencias vencidas e reivindica ate p_limit items com lease, ja com credenciais da instancia e os portoes de admin do grupo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Upsert do cache a partir da resposta da uazapiGO
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function refresh_group_cache_upsert(p_instance uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  gravados integer;
begin
  with entrada as (
    select * from jsonb_to_recordset(p_rows) as x(
      group_jid text, name text, topic text, owner_jid text, image_url text,
      participant_count integer, owner_is_admin boolean, owner_can_send boolean,
      is_announce boolean, is_locked boolean, is_parent boolean,
      is_join_approval_required boolean, member_add_mode text,
      is_ephemeral boolean, disappearing_timer integer,
      linked_parent_jid text, addressing_mode text,
      invite_link text, group_created timestamptz, raw jsonb
    )
  ), gravando as (
    insert into group_cache (
      instance_id, group_jid, name, topic, owner_jid, image_url,
      participant_count, owner_is_admin, owner_can_send,
      is_announce, is_locked, is_parent, is_join_approval_required,
      member_add_mode, is_ephemeral, disappearing_timer,
      linked_parent_jid, addressing_mode, invite_link, group_created, raw, fetched_at
    )
    select p_instance, e.group_jid, e.name, e.topic, e.owner_jid, e.image_url,
           e.participant_count, coalesce(e.owner_is_admin, false), coalesce(e.owner_can_send, true),
           e.is_announce, e.is_locked, e.is_parent, e.is_join_approval_required,
           e.member_add_mode, e.is_ephemeral, e.disappearing_timer,
           e.linked_parent_jid, e.addressing_mode, e.invite_link, e.group_created, e.raw, now()
    from entrada e
    on conflict (instance_id, group_jid) do update set
      name = excluded.name, topic = excluded.topic, owner_jid = excluded.owner_jid,
      -- Uma listagem sem avatar nao deve apagar o avatar que ja temos.
      image_url = coalesce(excluded.image_url, group_cache.image_url),
      participant_count = coalesce(excluded.participant_count, group_cache.participant_count),
      owner_is_admin = excluded.owner_is_admin, owner_can_send = excluded.owner_can_send,
      is_announce = excluded.is_announce, is_locked = excluded.is_locked,
      is_parent = excluded.is_parent,
      is_join_approval_required = excluded.is_join_approval_required,
      member_add_mode = excluded.member_add_mode, is_ephemeral = excluded.is_ephemeral,
      disappearing_timer = excluded.disappearing_timer,
      linked_parent_jid = excluded.linked_parent_jid,
      addressing_mode = excluded.addressing_mode,
      invite_link = coalesce(excluded.invite_link, group_cache.invite_link),
      group_created = coalesce(excluded.group_created, group_cache.group_created),
      raw = excluded.raw, fetched_at = now()
    returning 1
  )
  select count(*) into gravados from gravando;

  return gravados;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retencao do historico das campanhas
--
-- Em lotes, devolvendo so a quantidade — mesma regra da migration 013, pelo
-- mesmo motivo (nao materializar resultado grande dentro do Worker).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function purge_group_history(p_cutoff timestamptz, p_limit integer default 2000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  removidos integer;
begin
  with alvo as (
    select r.id
    from group_task_runs r
    where r.status in ('done','failed','canceled')
      and coalesce(r.opened_at, r.run_at) < p_cutoff
    order by r.run_at
    limit greatest(p_limit, 0)
  ), apagados as (
    delete from group_task_runs r
    using alvo
    where r.id = alvo.id
    returning 1
  )
  select count(*) into removidos from apagados;

  return removidos;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Travas de acesso
--
-- Mesmo modelo das migrations 011/012/013: RLS ligada SEM POLICY nenhuma nega
-- tudo para anon e authenticated. Dado interno — o painel le e escreve pelo
-- servidor, com a service role. O revoke e defesa em profundidade para nao
-- depender so da RLS.
-- ─────────────────────────────────────────────────────────────────────────────
alter table group_cache      enable row level security;
alter table group_media      enable row level security;
alter table group_tasks      enable row level security;
alter table group_task_steps enable row level security;
alter table group_task_runs  enable row level security;
alter table group_task_items enable row level security;

revoke all on table
  group_cache, group_media, group_tasks,
  group_task_steps, group_task_runs, group_task_items
from anon, authenticated;

revoke execute on function open_due_group_runs()                              from public, anon, authenticated;
revoke execute on function reclaim_stale_group_items(integer)                 from public, anon, authenticated;
revoke execute on function claim_group_task_items(integer, integer, integer)  from public, anon, authenticated;
revoke execute on function refresh_group_cache_upsert(uuid, jsonb)            from public, anon, authenticated;
revoke execute on function purge_group_history(timestamptz, integer)          from public, anon, authenticated;

grant execute on function open_due_group_runs()                               to service_role;
grant execute on function reclaim_stale_group_items(integer)                  to service_role;
grant execute on function claim_group_task_items(integer, integer, integer)   to service_role;
grant execute on function refresh_group_cache_upsert(uuid, jsonb)             to service_role;
grant execute on function purge_group_history(timestamptz, integer)           to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket dos arquivos
--
-- PUBLICO de proposito. A uazapiGO busca a URL do lado dela, e numa tarefa
-- agendada busca DIAS depois: uma URL assinada que expira entre o agendamento e
-- a execucao falharia calada na hora do disparo. Os caminhos sao UUID, nunca
-- derivados de nome — mas quem tiver a URL ve o arquivo.
--
-- Nao faltam policies de storage: toda escrita passa pela service role a partir
-- de rota autenticada, e a leitura e publica pelo flag do bucket.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'group-assets', 'group-assets', true, 16777216,
  array['image/jpeg','image/png','image/webp','video/mp4',
        'audio/ogg','audio/mpeg','application/pdf','text/csv']
)
on conflict (id) do nothing;
