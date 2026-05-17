-- 0007_sanitize_full_name.sql
-- handle_new_user wrote raw_user_meta_data.full_name unfiltered. Strip
-- control chars, trim, cap at 80, fall back to email local-part if empty.
-- Trigger already exists from the baseline; only the function is replaced.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_clean text;
begin
  v_clean := trim(regexp_replace(
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    '[[:cntrl:]]', '', 'g'
  ));
  if length(v_clean) = 0 then
    v_clean := split_part(new.email, '@', 1);
  end if;
  v_clean := substring(v_clean for 80);

  insert into public.profiles (id, full_name)
  values (new.id, v_clean);
  return new;
end;
$$;

commit;
