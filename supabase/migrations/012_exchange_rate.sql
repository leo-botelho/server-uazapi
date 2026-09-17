-- ============================================================
-- Migration 012: cotacao do dolar para exibir gastos de IA em reais
--
-- A tabela ja foi criada manualmente no Supabase e um fluxo do n8n atualiza a
-- cotacao. Esta migration so registra a definicao no repositorio (identica a
-- criada) e fecha o acesso pela API, no mesmo modelo das tabelas de tokens:
--
--   - RLS ligada SEM policy + grants revogados de anon e authenticated.
--     Sem isso, qualquer um com a chave anon poderia GRAVAR uma cotacao falsa
--     e distorcer os valores em reais do painel.
--   - O painel le pelo servidor com a service role, apos checar o login.
--
-- ATENCAO ao fluxo do n8n que atualiza a cotacao:
--   - no Supabase (credencial com a service role key) ou no Postgres (conexao
--     direta como dono): continua funcionando;
--   - HTTP Request para a API REST usando a chave ANON: para de gravar depois
--     desta migration. Troque pela service role. O painel avisa quando a
--     cotacao fica velha, entao uma quebra dessas nao passa despercebida.
--
-- Idempotente e nao mexe na cotacao ja gravada.
--
-- rollback:
--   alter table exchange_rate disable row level security;
--   grant select, insert, update, delete on exchange_rate to anon, authenticated;
-- ============================================================

create table if not exists exchange_rate (
  id smallint primary key default 1,
  usd_to_brl numeric not null,
  updated_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);

comment on table exchange_rate is
  'Linha unica: cotacao USD -> BRL atualizada por fluxo do n8n. Usada para exibir os gastos de IA em reais.';

alter table exchange_rate enable row level security;

revoke all on table exchange_rate from anon, authenticated;
