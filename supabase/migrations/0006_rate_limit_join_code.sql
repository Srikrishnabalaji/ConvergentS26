-- 0006_rate_limit_join_code.sql
-- Throttle join_group_by_code to 10 attempts/minute per user to block
-- brute-forcing the 6-hex-char codespace. Attempts logged in
-- join_code_attempts (RLS on, no policies → RPC-only access).

begin;

create table if not exists public.join_code_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists join_code_attempts_user_time_idx
  on public.join_code_attempts (user_id, attempted_at desc);

alter table public.join_code_attempts enable row level security;

create or replace function public.join_group_by_code(p_code text)
returns json
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_group_id   uuid;
  v_group_name text;
  v_uid        uuid;
  v_recent     int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  delete from public.join_code_attempts
   where user_id = v_uid and attempted_at < now() - interval '1 day';

  select count(*) into v_recent
    from public.join_code_attempts
   where user_id = v_uid
     and attempted_at > now() - interval '1 minute';

  if v_recent >= 10 then
    return json_build_object('error', 'rate_limited');
  end if;

  -- Log before lookup so failed attempts count.
  insert into public.join_code_attempts (user_id) values (v_uid);

  p_code := upper(trim(p_code));

  select id, name into v_group_id, v_group_name
    from public.groups
   where join_code = p_code and is_private = true;

  if v_group_id is null then
    return json_build_object('error', 'invalid_code');
  end if;

  if exists (
    select 1 from public.group_members
    where group_id = v_group_id and user_id = v_uid
  ) then
    return json_build_object('error', 'already_member', 'group_name', v_group_name);
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_uid, 'member');

  return json_build_object('success', true, 'group_name', v_group_name);
end;
$$;

grant execute on function public.join_group_by_code(text) to authenticated;

commit;
