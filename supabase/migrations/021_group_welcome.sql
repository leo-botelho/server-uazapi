-- ============================================================
-- Migration 021: mensagem de boas-vindas nos grupos
--
-- Como funciona (e por que assim):
--   1. O webhook GLOBAL recebe o evento `groups` (so se o usuario assinar esse evento em
--      Configuracoes; o webhook POR INSTANCIA e dos agentes do n8n e nunca e tocado).
--   2. O webhook so ENFILEIRA, numa unica chamada a `enqueue_group_welcome()`: o Worker do plano
--      Free tem 10 ms de CPU e nao carrega logica nem palpite sobre o formato do evento.
--   3. Quem ENVIA e o agendador que ja existe, que ja tem ritmo por numero, bloqueio por
--      restricao do WhatsApp (463), lease sem reenvio e auditoria. A boas-vindas vira uma
--      tarefa agendada de um passo ("Boas-vindas: <grupo>") e aparece em Agendamentos.
--
-- Protecoes na propria funcao:
--   * DESLIGADO por padrao: so age em grupo com regra `enabled = true`.
--   * Reentrega do webhook nao duplica: `unique (instance, group, participant, bucket de 10 min)`.
--   * Quem entra na mesma janela entra na MESMA mensagem (uma tarefa so, nao uma por pessoa):
--     uma onda de 200 entradas nao vira 200 mensagens nem 200 linhas na tela de Agendamentos.
--   * Teto de 100 pessoas por grupo por hora; acima disso, ignora.
--   * Nunca da boas-vindas ao proprio numero da instancia.
--   * Mais de 20 pessoas de uma vez: sem marcar ninguem (uma mensagem com 200 @ e spam).
--
-- Placeholder da mensagem: {{mencao}} vira "@5521999990000 @5511988887777" (e marca essas pessoas)
-- ou, quando nao ha numero para marcar (participante oculto em grupo LID), "pessoal".
--
-- rollback:
--   drop function if exists enqueue_group_welcome(text, text, text[], text);
--   drop table if exists group_welcome_log, group_welcome_rules;
-- ============================================================

create table if not exists group_welcome_rules (
  instance_id   uuid        not null references instances(id) on delete cascade,
  group_jid     text        not null,
  enabled       boolean     not null default false,
  message       text        not null check (char_length(message) between 1 and 1000),
  -- Espera entre alguem entrar e a mensagem sair: parece menos robo e junta quem entra junto.
  delay_seconds integer     not null default 30 check (delay_seconds between 5 and 3600),
  updated_at    timestamptz not null default now(),
  primary key (instance_id, group_jid)
);

create table if not exists group_welcome_log (
  id              bigserial   primary key,
  instance_id     uuid        not null references instances(id) on delete cascade,
  group_jid       text        not null,
  participant_jid text        not null,
  -- Janela de 10 min: e a chave que torna a reentrega do mesmo evento inofensiva.
  bucket          bigint      not null,
  task_id         uuid        references group_tasks(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (instance_id, group_jid, participant_jid, bucket)
);

create index if not exists idx_group_welcome_log_task  on group_welcome_log (task_id);
create index if not exists idx_group_welcome_log_grupo on group_welcome_log (instance_id, group_jid, created_at desc);

create or replace function enqueue_group_welcome(
  p_token        text,
  p_group        text,
  p_participants text[],
  p_owner        text default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inst    uuid;
  v_regra   group_welcome_rules%rowtype;
  v_bucket  bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_novos   text[];
  v_task    uuid;
  v_step    uuid;
  v_run     uuid;
  v_nome    text;
  v_todos   text[];
  v_numeros text[];
  v_texto   text;
  v_payload jsonb;
begin
  select i.id into v_inst
  from instances i
  where i.uazapi_token = p_token and i.active;

  if v_inst is null then return 0; end if;

  select * into v_regra
  from group_welcome_rules
  where instance_id = v_inst and group_jid = p_group and enabled;

  if not found then return 0; end if;

  -- Teto por grupo por hora.
  if (select count(*) from group_welcome_log
      where instance_id = v_inst and group_jid = p_group
        and created_at > now() - interval '1 hour') >= 100 then
    return 0;
  end if;

  -- Quem entrou agora e ainda nao foi registrado nesta janela (atomico: a unique decide).
  with entrada as (
    select distinct j
    from unnest(p_participants) as j
    where j ~ '@(s\.whatsapp\.net|lid)$'
      and (p_owner is null or split_part(split_part(j, '@', 1), ':', 1) <> p_owner)
  ), gravado as (
    insert into group_welcome_log (instance_id, group_jid, participant_jid, bucket)
    select v_inst, p_group, j, v_bucket from entrada
    on conflict (instance_id, group_jid, participant_jid, bucket) do nothing
    returning participant_jid
  )
  select array_agg(participant_jid) into v_novos from gravado;

  if v_novos is null then return 0; end if;

  -- Ja ha uma boas-vindas deste grupo esperando para sair? Entra nela (trava a execucao: o
  -- agendador nao a abre enquanto atualizamos).
  select t.id, s.id, r.id into v_task, v_step, v_run
  from group_tasks t
  join group_task_steps s on s.task_id = t.id
  join group_task_runs  r on r.step_id = s.id
  where t.instance_id = v_inst
    and t.target_jids = array[p_group]
    and t.name like 'Boas-vindas:%'
    and t.status = 'scheduled'
    and r.status = 'scheduled'
    and r.run_at > now() + interval '3 seconds'
  order by r.run_at
  limit 1
  for update of r;

  if v_task is null then
    select coalesce(
             (select gc.name from group_cache gc where gc.instance_id = v_inst and gc.group_jid = p_group),
             p_group)
      into v_nome;

    insert into group_tasks (instance_id, name, target_jids, spacing_seconds, spacing_jitter_pct, status, starts_at)
    values (v_inst, left('Boas-vindas: ' || v_nome, 120), array[p_group], 60, 20, 'scheduled',
            now() + (v_regra.delay_seconds || ' seconds')::interval)
    returning id into v_task;

    insert into group_task_steps (task_id, step_order, kind, payload, schedule_mode, absolute_ats)
    values (v_task, 0, 'send_text', '{"text":"-"}'::jsonb, 'absolute',
            array[now() + (v_regra.delay_seconds || ' seconds')::interval])
    returning id into v_step;

    insert into group_task_runs (task_id, step_id, run_at, total)
    values (v_task, v_step, now() + (v_regra.delay_seconds || ' seconds')::interval, 1);
  end if;

  update group_welcome_log
  set task_id = v_task
  where instance_id = v_inst and group_jid = p_group and bucket = v_bucket
    and participant_jid = any (v_novos);

  -- A mensagem e refeita com TODAS as pessoas desta boas-vindas (as que ja estavam + as novas).
  select array_agg(distinct participante) into v_todos
  from (select participant_jid as participante from group_welcome_log where task_id = v_task) x;

  -- So da para marcar quem tem telefone visivel (em grupo LID o identificador e opaco).
  select array_agg(distinct split_part(split_part(j, '@', 1), ':', 1)) into v_numeros
  from unnest(v_todos) as j
  where j like '%@s.whatsapp.net';

  if v_regra.message like '%{{mencao}}%' and v_numeros is not null and array_length(v_numeros, 1) <= 20 then
    v_texto := replace(v_regra.message, '{{mencao}}',
                       (select string_agg('@' || n, ' ' order by n) from unnest(v_numeros) as n));
    v_payload := jsonb_build_object('text', v_texto, 'mentions', to_jsonb(v_numeros));
  else
    v_texto := replace(v_regra.message, '{{mencao}}', 'pessoal');
    v_payload := jsonb_build_object('text', v_texto);
  end if;

  update group_task_steps set payload = v_payload where id = v_step;

  return array_length(v_novos, 1);
end;
$$;

comment on function enqueue_group_welcome(text, text, text[], text) is
  'Enfileira (ou completa) a boas-vindas de um grupo para quem acabou de entrar. 0 quando nao ha regra ligada, quando ja foi registrado ou quando nao ha ninguem a receber.';

alter table group_welcome_rules enable row level security;
alter table group_welcome_log   enable row level security;
revoke all on table group_welcome_rules, group_welcome_log from anon, authenticated;

revoke execute on function enqueue_group_welcome(text, text, text[], text) from public, anon, authenticated;
grant  execute on function enqueue_group_welcome(text, text, text[], text) to service_role;
