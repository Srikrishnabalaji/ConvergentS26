-- 0016_audit_fixes.sql
-- Applies fixes for findings M-1 through L-1 from the 2026-05-18 audit.
-- Frontend handles M-4 (non-atomic friend removal) and L-2 (group fetch limit).

begin;

-- ── M-1a: Add CHECK constraint on friends.status ─────────────────────────────
-- The column had no constraint; a user could set status to arbitrary text via
-- the direct-table UPDATE path.

alter table public.friends
  add constraint friends_status_check
    check (status in ('pending', 'accepted', 'declined'));

-- ── M-1b: Tighten the accept policy — only status may change, and only to
-- 'accepted' from 'pending'. Without this, a user accepting a request could
-- also overwrite user_id to point to a different user.

drop policy if exists "Users can accept friend requests" on public.friends;

create policy "Users can accept friend requests"
  on public.friends for update
  using      (auth.uid() = friend_id and status = 'pending')
  with check (auth.uid() = friend_id and status = 'accepted');

-- ── M-2: Remove permissive direct-INSERT on groups ───────────────────────────
-- Any authenticated user could INSERT a row into groups directly, bypassing
-- the create_group RPC. This created orphaned groups (no admin member) and
-- let callers skip name/description length validation.
-- The SECURITY DEFINER create_group() function doesn't need a client INSERT
-- policy — it runs with elevated privileges.

drop policy if exists "Authenticated users can create groups" on public.groups;

-- ── M-3: Server-side guard — prevent the last admin from leaving a group ──────
-- The old path was a direct DELETE on group_members gated only by client-side
-- logic. This RPC enforces the last-admin check on the server.

create or replace function public.leave_group(p_group_id uuid)
returns json
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid         uuid;
  v_role        text;
  v_admin_count int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  select role into v_role
    from public.group_members
   where group_id = p_group_id and user_id = v_uid;

  if v_role is null then
    return json_build_object('error', 'not_member');
  end if;

  if v_role = 'admin' then
    select count(*) into v_admin_count
      from public.group_members
     where group_id = p_group_id and role = 'admin';

    if v_admin_count <= 1 then
      return json_build_object('error', 'last_admin');
    end if;
  end if;

  delete from public.group_members
   where group_id = p_group_id and user_id = v_uid;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.leave_group(uuid) to authenticated;

-- ── L-1a: Escape ILIKE wildcards in search_profiles ─────────────────────────
-- Unescaped % and _ in user input allowed enumerating all display names by
-- sending "%%" as the query (matches any string, returns 30 rows per call).

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

  -- Treat user input as a literal string, not a LIKE pattern.
  v_query := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name
    from public.profiles p
    where p.id <> auth.uid()
      and p.full_name ilike '%' || v_query || '%' escape '\'
    order by p.full_name asc
    limit 30;
end;
$$;

-- ── L-1b: Same wildcard fix in search_users_for_invite ───────────────────────

create or replace function public.search_users_for_invite(p_group_id uuid, p_query text)
returns table(user_id uuid, full_name text, avatar_url text)
language plpgsql security definer stable
set search_path = public, pg_catalog
as $$
declare
  v_query text;
begin
  if not public.is_admin_of_group(p_group_id) then
    return;
  end if;

  v_query := trim(coalesce(p_query, ''));
  if v_query = '' then
    return;
  end if;

  -- Treat user input as a literal string, not a LIKE pattern.
  v_query := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.avatar_url
    from public.profiles p
    where p.full_name ilike '%' || v_query || '%' escape '\'
      and p.id <> auth.uid()
      and not exists (
        select 1 from public.group_members gm
        where gm.group_id = p_group_id and gm.user_id = p.id
      )
      and not exists (
        select 1 from public.group_invites gi
        where gi.group_id = p_group_id
          and gi.invited_user_id = p.id
          and gi.status = 'pending'
      )
    order by p.full_name asc
    limit 20;
end;
$$;

commit;
