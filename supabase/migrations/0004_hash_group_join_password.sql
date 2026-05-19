-- 0004_hash_group_join_password.sql
-- Hash join_password with bcrypt (was plaintext + world-readable). Revoke
-- column-level SELECT on join_password and join_code; expose join_code to
-- admins via get_group_join_code(). Backfill existing plaintext rows.

begin;

create extension if not exists pgcrypto;

create or replace function public.hash_group_join_password()
returns trigger
language plpgsql
as $$
begin
  if new.join_password is null or new.join_password = '' then
    new.join_password := null;
    return new;
  end if;
  -- Already a bcrypt hash; leave alone.
  if left(new.join_password, 2) = '$2' then
    return new;
  end if;
  new.join_password := crypt(new.join_password, gen_salt('bf'));
  return new;
end;
$$;

drop trigger if exists hash_group_join_password_trg on public.groups;
create trigger hash_group_join_password_trg
  before insert or update of join_password on public.groups
  for each row execute function public.hash_group_join_password();

-- Backfill existing plaintext rows.
update public.groups
   set join_password = crypt(join_password, gen_salt('bf'))
 where join_password is not null
   and join_password <> ''
   and left(join_password, 2) <> '$2';

revoke select (join_password, join_code) on public.groups from authenticated, anon;

create or replace function public.join_friend_group(p_group_id uuid, p_password text default null)
returns json
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_join_password text;
  v_type          text;
  v_is_private    boolean;
begin
  select join_password, type, is_private
    into v_join_password, v_type, v_is_private
  from public.groups
  where id = p_group_id;

  if v_is_private then
    return json_build_object('error', 'private_group');
  end if;

  if v_type <> 'friends' then
    return json_build_object('error', 'wrong_type');
  end if;

  if v_join_password is not null and v_join_password <> '' then
    if p_password is null or p_password = '' then
      return json_build_object('error', 'incorrect_password');
    end if;
    if crypt(p_password, v_join_password) <> v_join_password then
      return json_build_object('error', 'incorrect_password');
    end if;
  end if;

  if exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    return json_build_object('error', 'already_member');
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (p_group_id, auth.uid(), 'member');

  return json_build_object('success', true);
end;
$$;

create or replace function public.get_group_join_code(p_group_id uuid)
returns text
language plpgsql security definer stable
set search_path = public, pg_catalog
as $$
declare
  v_code text;
begin
  if not public.is_admin_of_group(p_group_id) then
    return null;
  end if;
  select join_code into v_code from public.groups where id = p_group_id;
  return v_code;
end;
$$;

grant execute on function public.get_group_join_code(uuid) to authenticated;

commit;
