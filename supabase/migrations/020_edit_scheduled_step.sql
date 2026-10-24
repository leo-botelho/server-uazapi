-- ============================================================
-- Migration 020: editar o conteudo de um passo agendado, sem corrida com o agendador
--
-- O agendador le o conteudo do passo (`group_task_steps.payload`) a cada item que reivindica.
-- Se o conteudo for trocado enquanto uma execucao ja esta enviando, alguns grupos receberiam o
-- texto velho e outros o novo — o erro mais visivel que existe. Entao a troca so vale quando
-- NENHUMA execucao do passo saiu de `scheduled`, e a verificacao e a gravacao acontecem na MESMA
-- instrucao (nao ha janela entre "conferi" e "gravei").
--
-- Devolve true se gravou, false se alguma execucao ja abriu (ou o passo nao existe).
--
-- rollback: drop function if exists update_group_step_payload(uuid, jsonb);
-- ============================================================

create or replace function update_group_step_payload(p_step uuid, p_payload jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_gravou boolean;
begin
  with g as (
    update group_task_steps s
    set payload = p_payload
    where s.id = p_step
      and not exists (
        select 1 from group_task_runs r
        where r.step_id = s.id and r.status <> 'scheduled'
      )
      -- Tarefa terminada ou cancelada nao se edita.
      and exists (
        select 1 from group_tasks t
        where t.id = s.task_id and t.status in ('scheduled', 'paused', 'blocked')
      )
    returning 1
  )
  select exists (select 1 from g) into v_gravou;

  return v_gravou;
end;
$$;

revoke execute on function update_group_step_payload(uuid, jsonb) from public, anon, authenticated;
grant  execute on function update_group_step_payload(uuid, jsonb) to service_role;
