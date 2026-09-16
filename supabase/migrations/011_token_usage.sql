-- ============================================================
-- Migration 011: consumo de tokens de IA por agente
--
-- Origem: `Agentes de IA/token-usage-schema-supabase.sql` (16/09/2026).
-- As tabelas e os nomes das views foram mantidos — o workflow "Coleta de
-- Tokens" do n8n continua gravando do mesmo jeito. As diferencas corrigem
-- problemas encontrados na revisao:
--
-- 1. RLS. O script original criava as tabelas SEM row level security. No
--    Supabase, tabela no schema public sem RLS fica legivel E gravavel pela
--    chave anon via PostgREST: qualquer pessoa com essa chave leria os
--    telefones dos clientes finais (`session_id`) e poderia reescrever
--    `model_pricing`. Agora: RLS ligada, leitura so para admin autenticado,
--    nenhuma escrita via API. O coletor grava por conexao Postgres direta
--    como dono das tabelas, entao nao e afetado.
--
-- 2. Views com security_invoker. View comum no Postgres executa com os
--    privilegios do dono e ignora RLS — ligar RLS nas tabelas nao bastaria.
--
-- 3. Dia no fuso de Brasilia. `date_trunc('day', ...)` usa o fuso da sessao
--    (UTC no Supabase): o dia virava as 21h e o gasto das 21h-0h caia no dia
--    seguinte.
--
-- 4. Data da execucao, nao da coleta. `collected_at` e quando o coletor
--    rodou; com backlog ou lote parcial, o gasto caia no dia errado. Nova
--    coluna `executed_at` (opcional) — tudo usa
--    coalesce(executed_at, collected_at) ate o coletor passar a preenche-la.
--
-- 5. Precos nao sao mais sobrescritos ao reexecutar. O original fazia
--    `on conflict do update`, revertendo qualquer ajuste manual de preco.
--    Agora so preenche linhas que ainda estao zeradas.
--
-- 6. Funcoes agregadas para o painel. Somar linhas no Next.js estouraria o
--    limite de 1000 linhas do PostgREST e mostraria totais menores que os
--    reais, sem erro nenhum.
--
-- Idempotente: pode rodar mais de uma vez.
--
-- rollback:
--   drop function if exists token_cost_diario(timestamptz, timestamptz);
--   drop function if exists token_cost_por_agente(timestamptz, timestamptz);
--   drop view if exists v_token_cost_por_agente;
--   drop view if exists v_token_cost_daily_resumo;
--   drop view if exists v_token_cost_daily;
--   drop table if exists token_usage_log, token_usage_sync_state, model_pricing;
-- ============================================================

-- ── Tabelas ─────────────────────────────────────────────────

-- Uma linha por (execucao, no de modelo). Varias chamadas ao modelo na mesma
-- execucao chegam somadas numa linha so (call_count).
create table if not exists token_usage_log (
  id bigserial primary key,
  execution_id integer not null,
  workflow_id text not null,
  workflow_name text not null,
  node_name text not null,
  node_type text not null,
  provider text not null,
  model text,
  session_id text,                 -- telefone da conversa, quando identificavel
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  call_count integer not null default 1,
  collected_at timestamptz not null default now(),
  unique (execution_id, node_name)
);

-- Instante em que a execucao rodou no n8n. Nulo ate o coletor preencher.
alter table token_usage_log
  add column if not exists executed_at timestamptz;

comment on column token_usage_log.executed_at is
  'Inicio da execucao no n8n (execution_entity."startedAt"). Quando nulo, os relatorios usam collected_at.';

create index if not exists idx_token_usage_log_workflow_date
  on token_usage_log (workflow_name, collected_at);

create index if not exists idx_token_usage_log_session
  on token_usage_log (session_id);

create index if not exists idx_token_usage_log_quando
  on token_usage_log ((coalesce(executed_at, collected_at)));

create table if not exists token_usage_sync_state (
  workflow_id text primary key,
  workflow_name text,
  last_execution_id integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists model_pricing (
  model text primary key,
  price_input_per_1m numeric not null default 0,
  price_output_per_1m numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Precos confirmados em 16/09/2026 nas paginas oficiais (tier Standard).
-- So preenche modelos novos ou ainda zerados: nunca sobrescreve um preco
-- ajustado manualmente.
insert into model_pricing (model, price_input_per_1m, price_output_per_1m) values
  ('gpt-5.4-mini', 0.75, 4.50),
  ('gpt-5.1', 1.25, 10.00),
  ('gpt-4.1', 2.00, 8.00),
  ('gpt-4.1-mini', 0.40, 1.60),
  ('gpt-4o-mini', 0.15, 0.60),
  ('text-embedding-3-large', 0.13, 0),
  ('gemini-2.5-flash', 0.30, 2.50)
on conflict (model) do update
  set price_input_per_1m  = excluded.price_input_per_1m,
      price_output_per_1m = excluded.price_output_per_1m,
      updated_at          = now()
  where model_pricing.price_input_per_1m = 0
    and model_pricing.price_output_per_1m = 0;

-- ── Seguranca ───────────────────────────────────────────────

alter table token_usage_log        enable row level security;
alter table token_usage_sync_state enable row level security;
alter table model_pricing          enable row level security;

drop policy if exists "admins_select" on token_usage_log;
create policy "admins_select" on token_usage_log
  for select to authenticated using (true);

drop policy if exists "admins_select" on token_usage_sync_state;
create policy "admins_select" on token_usage_sync_state
  for select to authenticated using (true);

drop policy if exists "admins_select" on model_pricing;
create policy "admins_select" on model_pricing
  for select to authenticated using (true);

-- Defesa em profundidade: a chave anon nao tem nada a fazer aqui.
revoke all on table token_usage_log, token_usage_sync_state, model_pricing from anon;

-- ── Views (mesmos nomes do script original) ─────────────────

drop view if exists v_token_cost_por_agente;
drop view if exists v_token_cost_daily_resumo;
drop view if exists v_token_cost_daily;

create view v_token_cost_daily
with (security_invoker = true) as
select
  t.workflow_name,
  (coalesce(t.executed_at, t.collected_at) at time zone 'America/Sao_Paulo')::date as dia,
  t.node_name,
  t.provider,
  t.model,
  sum(t.prompt_tokens)     as prompt_tokens,
  sum(t.completion_tokens) as completion_tokens,
  sum(t.total_tokens)      as total_tokens,
  sum(t.call_count)        as chamadas,
  round(
    sum(t.prompt_tokens)     / 1000000.0 * coalesce(p.price_input_per_1m, 0) +
    sum(t.completion_tokens) / 1000000.0 * coalesce(p.price_output_per_1m, 0)
  , 4) as custo_estimado_usd
from token_usage_log t
left join model_pricing p on p.model = t.model
group by 1, 2, t.node_name, t.provider, t.model, p.price_input_per_1m, p.price_output_per_1m;

create view v_token_cost_daily_resumo
with (security_invoker = true) as
select
  workflow_name,
  dia,
  sum(total_tokens)       as total_tokens,
  sum(custo_estimado_usd) as custo_estimado_usd
from v_token_cost_daily
group by workflow_name, dia;

create view v_token_cost_por_agente
with (security_invoker = true) as
select
  workflow_name,
  sum(total_tokens)       as total_tokens,
  sum(custo_estimado_usd) as custo_estimado_usd,
  min(dia)                as primeira_coleta,
  max(dia)                as ultima_coleta
from v_token_cost_daily
group by workflow_name;

revoke all on v_token_cost_daily, v_token_cost_daily_resumo, v_token_cost_por_agente from anon;

-- ── Funcoes para o painel ───────────────────────────────────

-- Totais por agente num intervalo [p_desde, p_ate).
-- O custo e calculado linha a linha e somado, equivalente as views.
create or replace function token_cost_por_agente(p_desde timestamptz, p_ate timestamptz)
returns table (
  workflow_name     text,
  custo_usd         numeric,
  prompt_tokens     bigint,
  completion_tokens bigint,
  total_tokens      bigint,
  chamadas          bigint,
  execucoes         bigint,
  conversas         bigint,
  tokens_sem_preco  bigint,
  modelos           text[],
  modelos_sem_preco text[],
  ultima_execucao   timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.workflow_name,
    round(sum(
      t.prompt_tokens     / 1000000.0 * coalesce(p.price_input_per_1m, 0) +
      t.completion_tokens / 1000000.0 * coalesce(p.price_output_per_1m, 0)
    ), 6),
    sum(t.prompt_tokens)::bigint,
    sum(t.completion_tokens)::bigint,
    sum(t.total_tokens)::bigint,
    sum(t.call_count)::bigint,
    count(distinct t.execution_id)::bigint,
    count(distinct t.session_id)::bigint,
    -- tokens de modelo sem preco cadastrado: entram como custo zero, entao o
    -- painel precisa avisar que o total esta subestimado
    coalesce(sum(t.total_tokens) filter (where p.model is null), 0)::bigint,
    coalesce(array_agg(distinct t.model) filter (where t.model is not null), '{}'),
    coalesce(array_agg(distinct coalesce(t.model, '(modelo nao identificado)')) filter (where p.model is null), '{}'),
    max(coalesce(t.executed_at, t.collected_at))
  from token_usage_log t
  left join model_pricing p on p.model = t.model
  where coalesce(t.executed_at, t.collected_at) >= p_desde
    and coalesce(t.executed_at, t.collected_at) <  p_ate
  group by t.workflow_name
  order by 2 desc;
$$;

-- Serie diaria por agente num intervalo [p_desde, p_ate), dia em Brasilia.
create or replace function token_cost_diario(p_desde timestamptz, p_ate timestamptz)
returns table (
  dia           date,
  workflow_name text,
  custo_usd     numeric,
  total_tokens  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (coalesce(t.executed_at, t.collected_at) at time zone 'America/Sao_Paulo')::date,
    t.workflow_name,
    round(sum(
      t.prompt_tokens     / 1000000.0 * coalesce(p.price_input_per_1m, 0) +
      t.completion_tokens / 1000000.0 * coalesce(p.price_output_per_1m, 0)
    ), 6),
    sum(t.total_tokens)::bigint
  from token_usage_log t
  left join model_pricing p on p.model = t.model
  where coalesce(t.executed_at, t.collected_at) >= p_desde
    and coalesce(t.executed_at, t.collected_at) <  p_ate
  group by 1, 2
  order by 1, 2;
$$;

revoke execute on function token_cost_por_agente(timestamptz, timestamptz) from public, anon;
revoke execute on function token_cost_diario(timestamptz, timestamptz)     from public, anon;
grant  execute on function token_cost_por_agente(timestamptz, timestamptz) to authenticated, service_role;
grant  execute on function token_cost_diario(timestamptz, timestamptz)     to authenticated, service_role;
