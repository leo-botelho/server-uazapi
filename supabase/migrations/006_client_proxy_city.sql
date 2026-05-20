-- Add managed proxy city/state to clients so every connection
-- automatically uses a local proxy for that client's region.
-- rollback: alter table clients drop column proxy_state; alter table clients drop column proxy_city;

alter table clients
  add column proxy_city  text,
  add column proxy_state text;

comment on column clients.proxy_city  is 'uazapiGO managed proxy city value (e.g. "campinas")';
comment on column clients.proxy_state is 'uazapiGO managed proxy state abbreviation (e.g. "sp")';
