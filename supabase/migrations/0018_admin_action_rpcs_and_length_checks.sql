-- 0018_admin_action_rpcs_and_length_checks.sql
-- M-1: Block admin-vs-admin role rewrites at the server. The
--      "Admins can update group member roles" RLS policy let any admin
--      change any other admin's role (or remove them via the DELETE
--      policy's `admins can remove members` clause). Replace both with
--      SECURITY DEFINER RPCs that enforce the rule the UI already shows:
--      only the founding admin (earliest joined_at) may demote or remove
--      another admin or editor.
-- M-2: Add CHECK constraints on groups.{name,description,image_url,
--      join_password} so direct UPDATEs by admins (edit-group screen)
--      can't push values past the limits create_group enforces on insert.
-- L-2: Same length-cap treatment on events.{title,location,time}.
-- Constraints are NOT VALID — they apply to new writes; pre-existing rows
-- aren't re-checked.

begin;

-- ── M-1: replace permissive RLS with founder-aware RPCs ─────────────────────

drop policy if exists "Admins can update group member roles" on public.group_members;

drop policy if exists "Users can leave groups; admins can remove members"
  on public.group_members;

-- Self-leave only. Admin-removes-other goes through remove_group_member.
create policy "Users can leave groups"
  on public.group_members for delete
  using (auth.uid() = user_id);

create or replace function public.change_member_role(
  p_group_id       uuid,
  p_target_user_id uuid,
  p_new_role       text
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid           uuid;
  v_caller_role   text;
  v_target_role   text;
  v_founder_id    uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if p_new_role not in ('admin', 'editor', 'member') then
    return json_build_object('error', 'invalid_role');
  end if;

  if p_target_user_id = v_uid then
    return json_build_object('error', 'cannot_modify_self');
  end if;

  select role into v_caller_role
    from public.group_members
   where group_id = p_group_id and user_id = v_uid;

  if v_caller_role is null or v_caller_role <> 'admin' then
    return json_build_object('error', 'not_authorized');
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group_id and user_id = p_target_user_id;

  if v_target_role is null then
    return json_build_object('error', 'not_member');
  end if;

  if v_target_role = p_new_role then
    return json_build_object('success', true);
  end if;

  -- Modifying another admin's or editor's role requires the founder
  -- (earliest-joined admin). This blocks admin-vs-admin coups.
  if v_target_role in ('admin', 'editor') then
    select user_id into v_founder_id
      from public.group_members
     where group_id = p_group_id and role = 'admin'
     order by joined_at asc nulls last, user_id asc
     limit 1;

    if v_uid is distinct from v_founder_id then
      return json_build_object('error', 'founder_only');
    end if;
  end if;

  update public.group_members
     set role = p_new_role
   where group_id = p_group_id and user_id = p_target_user_id;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;

create or replace function public.remove_group_member(
  p_group_id       uuid,
  p_target_user_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid          uuid;
  v_caller_role  text;
  v_target_role  text;
  v_founder_id   uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if p_target_user_id = v_uid then
    return json_build_object('error', 'use_leave_group');
  end if;

  select role into v_caller_role
    from public.group_members
   where group_id = p_group_id and user_id = v_uid;

  if v_caller_role is null or v_caller_role <> 'admin' then
    return json_build_object('error', 'not_authorized');
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group_id and user_id = p_target_user_id;

  if v_target_role is null then
    return json_build_object('error', 'not_member');
  end if;

  if v_target_role in ('admin', 'editor') then
    select user_id into v_founder_id
      from public.group_members
     where group_id = p_group_id and role = 'admin'
     order by joined_at asc nulls last, user_id asc
     limit 1;

    if v_uid is distinct from v_founder_id then
      return json_build_object('error', 'founder_only');
    end if;
  end if;

  delete from public.group_members
   where group_id = p_group_id and user_id = p_target_user_id;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- ── M-2: length CHECK constraints on groups ─────────────────────────────────

alter table public.groups
  add constraint groups_name_length_check
    check (char_length(name) between 1 and 120) not valid;

alter table public.groups
  add constraint groups_description_length_check
    check (description is null or char_length(description) <= 1000) not valid;

alter table public.groups
  add constraint groups_image_url_length_check
    check (image_url is null or char_length(image_url) <= 2048) not valid;

-- bcrypt hashes are 60 chars; the hash_group_join_password trigger rejects
-- raw inputs over 200 chars already. This constraint catches anyone bypassing
-- the trigger (e.g., service-role writes).
alter table public.groups
  add constraint groups_join_password_length_check
    check (join_password is null or char_length(join_password) <= 200) not valid;

-- ── L-2: length CHECK constraints on events ─────────────────────────────────

alter table public.events
  add constraint events_title_length_check
    check (char_length(title) between 1 and 200) not valid;

alter table public.events
  add constraint events_location_length_check
    check (location is null or char_length(location) <= 300) not valid;

alter table public.events
  add constraint events_time_length_check
    check (char_length(time) between 1 and 20) not valid;

commit;
