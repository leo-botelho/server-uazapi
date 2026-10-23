-- ============================================================
-- Migration 014: marcar instancias que sumiram do uazapiGO
--
-- Quando uma instancia e excluida no painel do uazapiGO, o monitor
-- simplesmente nao a encontrava na listagem e seguia em frente: o cadastro
-- ficava para sempre no painel, aparecendo como se existisse.
--
-- `missing_since` guarda desde quando ela deixou de aparecer. O monitor
-- preenche e limpa sozinho; a EXCLUSAO do cadastro continua sendo uma acao
-- deliberada do operador, porque apagar a linha leva junto o historico
-- (webhook_events, notifications_log, reconnect_tokens cascateiam).
--
-- rollback: alter table instances drop column if exists missing_since;
-- ============================================================

alter table instances
  add column if not exists missing_since timestamptz;

comment on column instances.missing_since is
  'Desde quando a instancia nao aparece mais na listagem do uazapiGO. NULL = presente. Preenchido pelo monitor.';
