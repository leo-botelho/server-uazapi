-- Migration 009: suporte ao status `hibernated` + confiabilidade de alertas
--
-- 1. `hibernated` é um estado documentado da API uazapiGO ("sessão pausada, com
--    credenciais preservadas para reconexão"). O CHECK antigo aceitava apenas 3
--    estados, então qualquer UPDATE com `hibernated` era REJEITADO pelo banco.
--    Efeito prático: a instância hibernava, o UPDATE falhava silenciosamente
--    (erro só no console) e o painel seguia mostrando "conectado" — falso verde.
--
-- 2. `notifications_log` ganha rastreio de supressão/reprocessamento para que
--    alertas caídos na janela de silêncio não sejam perdidos para sempre.
--
-- rollback:
--   alter table instances drop constraint instances_status_check;
--   alter table instances add constraint instances_status_check
--     check (status in ('connected','disconnected','connecting'));
--   alter table notifications_log drop column if exists scheduled_for;
--   alter table notifications_log drop column if exists reason;
--   alter table instances drop column if exists last_seen_at;

-- ── 1. Aceitar `hibernated` ──────────────────────────────────────────────────
alter table instances drop constraint if exists instances_status_check;

alter table instances
  add constraint instances_status_check
  check (status in ('connected', 'disconnected', 'connecting', 'hibernated'));

-- ── 2. Alertas: suportar estado suprimido/pendente ───────────────────────────
-- `pending` já existia no CHECK original; agora ganha semântica real:
-- alerta adiado pela janela de silêncio, a ser reenviado pelo monitor.
alter table notifications_log
  add column if not exists scheduled_for timestamptz,
  add column if not exists reason        text;

comment on column notifications_log.scheduled_for is
  'Quando o alerta pendente deve ser reenviado (usado pela janela de silêncio).';
comment on column notifications_log.reason is
  'Motivo de supressão/adiamento — ex: silence_window, channel_none.';

create index if not exists notifications_log_pending_idx
  on notifications_log (scheduled_for)
  where status = 'pending';

-- ── 3. Marcar a última vez que a instância foi vista no uazapiGO ─────────────
-- Permite o portal do cliente decidir se o status do banco está velho demais
-- e precisa ser confirmado direto na API.
alter table instances
  add column if not exists last_seen_at timestamptz;

comment on column instances.last_seen_at is
  'Último instante em que o status foi confirmado pelo uazapiGO (webhook ou monitor).';
