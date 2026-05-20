-- Auto-create admin_profiles row when a new auth.users row is inserted.
-- This ensures every admin that registers via Supabase Auth automatically
-- gets a profile row, so /api/profile never returns null on first access.
-- rollback: drop trigger if exists on_auth_user_created on auth.users;
--           drop function if exists public.handle_new_user();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Drop the trigger first in case this migration is run more than once
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
