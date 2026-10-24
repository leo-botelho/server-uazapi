-- ============================================================
-- Migration 019: libera marcar todos com intervalo abaixo de 60 s (modo avancado)
--
-- A 015 criou `group_tasks_mention_all_spacing`: marcar todos exigia 60 s entre grupos, sem
-- excecao. Era uma recomendacao minha, nao uma regra do WhatsApp, e o usuario opera com
-- intervalos de 5 s e mais de 10 grupos marcando todos no n8n, sem problema.
--
-- O que PROTEGE agora, no lugar da trava do banco: as rotas so aceitam marcar todos abaixo de
-- 60 s (ou acima de 10 grupos) quando a requisicao traz a confirmacao explicita do "modo
-- avancado" (`aceitoRiscoMarcarTodos`). O piso geral de 5 s (`spacing_seconds >= 5`) continua
-- no banco, e o ritmo entre acoes do numero continua imposto por reserve_group_instance_slot.
--
-- rollback: so se NENHUMA linha de group_tasks tiver mention_all com spacing_seconds < 60
--   (senao o add constraint falha):
--   alter table group_tasks add constraint group_tasks_mention_all_spacing
--     check (not mention_all or spacing_seconds >= 60);
-- ============================================================

alter table group_tasks drop constraint if exists group_tasks_mention_all_spacing;
