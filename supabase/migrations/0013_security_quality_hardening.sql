-- 0013_security_quality_hardening.sql
-- Follow-up hardening from the security/code-quality audit.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER search_path hardening
-- ---------------------------------------------------------------------------

alter function public.is_member_of_group(uuid) set search_path = public, pg_catalog;
alter function public.is_admin_of_group(uuid) set search_path = public, pg_catalog;
alter function public.create_group(text, text, text, boolean, text, text) set search_path = public, pg_catalog;
alter function public.handle_join_request(uuid, text) set search_path = public, pg_catalog;
alter function public.regenerate_group_join_code(uuid) set search_path = public, pg_catalog;
alter function public.get_my_join_requests() set search_path = public, pg_catalog;
alter function public.get_group_join_requests(uuid) set search_path = public, pg_catalog;
alter function public.search_users_for_invite(uuid, text) set search_path = public, pg_catalog;
alter function public.invite_user_to_group(uuid, uuid) set search_path = public, pg_catalog;
alter function public.get_group_invites(uuid) set search_path = public, pg_catalog;
alter function public.revoke_group_invite(uuid) set search_path = public, pg_catalog;
alter function public.get_my_group_invites() set search_path = public, pg_catalog;
alter function public.respond_to_group_invite(uuid, text) set search_path = public, pg_catalog;
alter function public.get_group_member_counts() set search_path = public, pg_catalog;

-- ---------------------------------------------------------------------------
-- Group join codes: longer, CSPRNG-backed codes.
-- ---------------------------------------------------------------------------

create or replace function public.manage_group_join_code()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_code text;
begin
  if new.is_private = true and new.join_code is null then
    loop
      v_code := upper(encode(gen_random_bytes(5), 'hex'));
      exit when not exists (
        select 1 from public.groups where join_code = v_code and id is distinct from new.id
      );
    end loop;
    new.join_code := v_code;
  elsif new.is_private = false then
    new.join_code := null;
  end if;
  return new;
end;
$$;

create or replace function public.regenerate_group_join_code(p_group_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_new_code   text;
  v_is_private boolean;
begin
  select is_private into v_is_private from public.groups where id = p_group_id;

  if not coalesce(v_is_private, false) then
    return json_build_object('error', 'not_private');
  end if;

  if not public.is_admin_of_group(p_group_id) then
    return json_build_object('error', 'not_authorized');
  end if;

  loop
    v_new_code := upper(encode(gen_random_bytes(5), 'hex'));
    exit when not exists (
      select 1 from public.groups where join_code = v_new_code and id <> p_group_id
    );
  end loop;

  update public.groups set join_code = v_new_code where id = p_group_id;
  return json_build_object('success', true, 'join_code', v_new_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Friend requests: clients may only create pending outbound requests.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can send friend requests" on public.friends;

create policy "Users can send friend requests"
  on public.friends for insert
  with check (
    auth.uid() = user_id
    and friend_id is not null
    and friend_id <> auth.uid()
    and status = 'pending'
  );

create unique index if not exists friends_pair_unique_idx
  on public.friends (least(user_id, friend_id), greatest(user_id, friend_id));

-- ---------------------------------------------------------------------------
-- Location sharing: shares may only be granted to accepted friends.
-- ---------------------------------------------------------------------------

drop policy if exists "Owners grant location shares" on public.location_shares;

create policy "Owners grant location shares"
  on public.location_shares for insert
  with check (
    owner_id = auth.uid()
    and viewer_id is not null
    and viewer_id <> owner_id
    and exists (
      select 1
      from public.friends f
      where f.status = 'accepted'
        and (
          (f.user_id = owner_id and f.friend_id = viewer_id)
          or
          (f.friend_id = owner_id and f.user_id = viewer_id)
        )
    )
  );

-- Pending friend requests only reveal the requester to the recipient. Accepted
-- friendships keep bidirectional profile visibility.
drop policy if exists "View profiles of friend-graph counterparties" on public.profiles;

create policy "View profiles of friend-graph counterparties"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.friends f
      where (
        f.status = 'accepted'
        and (
          (f.user_id = auth.uid() and f.friend_id = profiles.id)
          or
          (f.friend_id = auth.uid() and f.user_id = profiles.id)
        )
      )
      or (
        f.status = 'pending'
        and f.friend_id = auth.uid()
        and f.user_id = profiles.id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Groups: admins keep full direct updates; editors use a narrow RPC.
-- ---------------------------------------------------------------------------

drop policy if exists "Admins or editors can update their groups" on public.groups;

create policy "Admins can update their groups"
  on public.groups for update
  using (public.is_admin_of_group(id))
  with check (public.is_admin_of_group(id));

-- Keep the location pin/share update atomic and server-validated.
create or replace function public.save_location_pin(
  p_building text,
  p_room text default null,
  p_viewer_ids uuid[] default '{}'
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid;
  v_building text;
  v_room text;
  v_viewer_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  v_building := trim(coalesce(p_building, ''));
  v_room := nullif(trim(coalesce(p_room, '')), '');
  if length(v_building) < 1 or length(v_building) > 160 then
    return json_build_object('error', 'invalid_building');
  end if;
  if v_room is not null and length(v_room) > 80 then
    return json_build_object('error', 'invalid_room');
  end if;

  if coalesce(array_length(p_viewer_ids, 1), 0) > 200 then
    return json_build_object('error', 'too_many_viewers');
  end if;

  foreach v_viewer_id in array coalesce(p_viewer_ids, '{}') loop
    if v_viewer_id is null or v_viewer_id = v_uid then
      return json_build_object('error', 'invalid_viewer');
    end if;
    if not exists (
      select 1
      from public.friends f
      where f.status = 'accepted'
        and (
          (f.user_id = v_uid and f.friend_id = v_viewer_id)
          or
          (f.friend_id = v_uid and f.user_id = v_viewer_id)
        )
    ) then
      return json_build_object('error', 'viewer_not_friend');
    end if;
  end loop;

  update public.profiles
     set location_building = v_building,
         location_room = v_room,
         updated_at = now()
   where id = v_uid;

  delete from public.location_shares where owner_id = v_uid;

  insert into public.location_shares (owner_id, viewer_id)
  select v_uid, distinct_viewer_id
  from (
    select distinct unnest(coalesce(p_viewer_ids, '{}')) as distinct_viewer_id
  ) viewers
  where distinct_viewer_id is not null
    and distinct_viewer_id <> v_uid;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.save_location_pin(text, text, uuid[]) to authenticated;

create or replace function public.clear_location_pin()
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  update public.profiles
     set location_building = null,
         location_room = null,
         updated_at = now()
   where id = v_uid;

  delete from public.location_shares where owner_id = v_uid;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.clear_location_pin() to authenticated;

create or replace function public.update_group_description(
  p_group_id uuid,
  p_description text
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_description text;
begin
  if not exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role in ('admin', 'editor')
  ) then
    return json_build_object('error', 'not_authorized');
  end if;

  v_description := nullif(trim(coalesce(p_description, '')), '');
  if v_description is not null and length(v_description) > 1000 then
    return json_build_object('error', 'description_too_long');
  end if;

  update public.groups
     set description = v_description
   where id = p_group_id;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.update_group_description(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Server-side group validation.
-- ---------------------------------------------------------------------------

create or replace function public.create_group(
  p_name          text,
  p_description   text    default null,
  p_type          text    default 'friends',
  p_is_private    boolean default false,
  p_join_password text    default null,
  p_image_url     text    default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_group_id uuid;
  v_name text;
  v_description text;
  v_image_url text;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  v_name := trim(coalesce(p_name, ''));
  if length(v_name) < 1 or length(v_name) > 120 then
    return json_build_object('error', 'invalid_name');
  end if;

  if p_type not in ('friends', 'campus_org') then
    return json_build_object('error', 'invalid_type');
  end if;

  v_description := nullif(trim(coalesce(p_description, '')), '');
  if v_description is not null and length(v_description) > 1000 then
    return json_build_object('error', 'description_too_long');
  end if;

  v_image_url := nullif(trim(coalesce(p_image_url, '')), '');
  if v_image_url is not null and length(v_image_url) > 2048 then
    return json_build_object('error', 'invalid_image_url');
  end if;

  insert into public.groups (name, description, type, is_private, join_password, image_url)
  values (
    v_name,
    v_description,
    p_type,
    p_is_private,
    case
      when p_is_private or p_type <> 'friends' then null
      else nullif(trim(coalesce(p_join_password, '')), '')
    end,
    v_image_url
  )
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'admin');

  return json_build_object('id', v_group_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Data minimization and performance indexes.
-- ---------------------------------------------------------------------------

create or replace function public.get_group_member_counts()
returns table(group_id uuid, member_count bigint)
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select gm.group_id, count(*)::bigint
  from public.group_members gm
  where exists (
    select 1
    from public.groups g
    where g.id = gm.group_id
      and (
        g.is_private = false
        or public.is_member_of_group(g.id)
        or exists (
          select 1
          from public.group_invites gi
          where gi.group_id = g.id
            and gi.invited_user_id = auth.uid()
            and gi.status = 'pending'
        )
      )
  )
  group by gm.group_id;
$$;

create index if not exists events_user_id_idx on public.events(user_id);
create index if not exists events_user_date_idx on public.events(user_id, event_date);
create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (full_name gin_trgm_ops);

-- Make remaining update policies explicit.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Submitter can remove their own alert" on public.campus_alerts;
create policy "Submitter can remove their own alert"
  on public.campus_alerts for update
  using (submitted_by = auth.uid())
  with check (submitted_by = auth.uid());

drop policy if exists "Users can update their own vote" on public.alert_votes;
create policy "Users can update their own vote"
  on public.alert_votes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

commit;
