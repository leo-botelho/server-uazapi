-- ============================================================
-- Migration 017: links curtos com contagem de cliques (/l/<slug>)
--
-- O WhatsApp so deixa clicavel um endereco http(s); um esquema de app colado na
-- mensagem (instagram://...) nao funciona. O link curto resolve: e https, e no
-- celular a pagina tenta abrir o app e cai para o site. E tambem o que da a
-- contagem de cliques dos convites de grupo.
--
-- A pagina publica /l/<slug> e aberta por visitante ANONIMO, entao nada aqui e
-- legivel por anon/authenticated: a rota le e conta pela service role, e
-- resolve_short_link() faz as duas coisas numa ida so (no plano Free do
-- Cloudflare cada chamada externa e CPU).
--
-- rollback:
--   drop function if exists resolve_short_link(text, boolean);
--   drop table if exists short_links;
-- ============================================================

create table if not exists short_links (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),

  -- O tipo decide para onde o link pode apontar (a rota valida o dominio).
  kind          text not null
    check (kind in ('youtube', 'instagram', 'whatsapp_grupo', 'whatsapp_conversa')),
  target_url    text not null check (target_url ~ '^https://'),
  label         text,

  active        boolean not null default true,
  clicks        integer not null default 0,
  last_click_at timestamptz,

  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

-- Resolve o slug e, se for clique de pessoa, conta. Uma instrucao so: duas
-- visitas simultaneas nao perdem contagem. Link desativado nao resolve.
create or replace function resolve_short_link(p_slug text, p_count boolean default true)
returns table (kind text, target_url text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_count then
    return query
      update short_links s
      set clicks = s.clicks + 1, last_click_at = now()
      where s.slug = p_slug and s.active
      returning s.kind, s.target_url;
  else
    return query
      select s.kind, s.target_url
      from short_links s
      where s.slug = p_slug and s.active;
  end if;
end;
$$;

-- Mesmo modelo das migrations 011/012/013/015/016.
alter table short_links enable row level security;
revoke all on table short_links from anon, authenticated;

revoke execute on function resolve_short_link(text, boolean) from public, anon, authenticated;
grant  execute on function resolve_short_link(text, boolean) to service_role;
