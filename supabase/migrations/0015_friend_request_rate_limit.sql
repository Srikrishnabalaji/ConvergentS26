-- 0015_friend_request_rate_limit.sql
-- M-2: Replace direct INSERT on the friends table with a SECURITY DEFINER
--      RPC that enforces a rate limit (10 requests per hour per user).
--      The direct INSERT policy is unchanged — only the RPC should be used
--      by clients (the RLS INSERT policy on friends is enforced inside the
--      function via the elevated role; clients no longer need direct INSERT).

begin;

-- Attempt log: one row per outgoing friend request, pruned after 24 hours.
create table if not exists public.friend_request_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists friend_request_attempts_user_time_idx
  on public.friend_request_attempts (user_id, attempted_at desc);

alter table public.friend_request_attempts enable row level security;
-- No RLS policies: table is only accessible via this SECURITY DEFINER function.

create or replace function public.send_friend_request(p_friend_id uuid)
returns json
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid    uuid;
  v_recent int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if v_uid = p_friend_id then
    return json_build_object('error', 'cannot_add_self');
  end if;

  -- Prune old attempts (keep 24 h of history for abuse investigation).
  delete from public.friend_request_attempts
   where user_id = v_uid and attempted_at < now() - interval '1 day';

  -- Rate limit: 10 new requests per hour.
  select count(*) into v_recent
    from public.friend_request_attempts
   where user_id = v_uid
     and attempted_at > now() - interval '1 hour';

  if v_recent >= 10 then
    return json_build_object('error', 'rate_limited');
  end if;

  -- Reject if a request already exists in either direction.
  if exists (
    select 1 from public.friends
     where (user_id = v_uid and friend_id = p_friend_id)
        or (user_id = p_friend_id and friend_id = v_uid)
  ) then
    return json_build_object('error', 'already_exists');
  end if;

  -- Verify target user exists.
  if not exists (select 1 from public.profiles where id = p_friend_id) then
    return json_build_object('error', 'user_not_found');
  end if;

  insert into public.friend_request_attempts (user_id) values (v_uid);

  insert into public.friends (user_id, friend_id, status)
  values (v_uid, p_friend_id, 'pending');

  return json_build_object('success', true);
end;
$$;

grant execute on function public.send_friend_request(uuid) to authenticated;

commit;
