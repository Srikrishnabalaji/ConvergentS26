-- 0005_search_profiles_rpc.sql
-- Find Friends used `.from('profiles').select(...)` directly, relying on the
-- world-readable profile policy. Move to a SECURITY DEFINER RPC: requires
-- auth, min 2 chars, limit 30, excludes the caller.

begin;

create or replace function public.search_profiles(p_query text)
returns table(id uuid, full_name text)
language plpgsql security definer stable
set search_path = public, pg_catalog
as $$
declare
  v_query text;
begin
  if auth.uid() is null then
    return;
  end if;

  v_query := trim(coalesce(p_query, ''));
  if length(v_query) < 2 then
    return;
  end if;

  return query
    select p.id, p.full_name
    from public.profiles p
    where p.id <> auth.uid()
      and p.full_name ilike '%' || v_query || '%'
    order by p.full_name asc
    limit 30;
end;
$$;

grant execute on function public.search_profiles(text) to authenticated;

commit;
