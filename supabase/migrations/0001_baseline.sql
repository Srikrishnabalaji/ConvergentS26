-- 0001_baseline.sql
-- Snapshot of the production schema as of 2026-05-16. Preserves known bugs
-- verbatim; later migrations fix them. Idempotent (IF NOT EXISTS / OR
-- REPLACE / DROP POLICY IF EXISTS).
-- DO NOT EDIT TO FIX BUGS. Add a new migration instead.

begin;

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

create or replace function public.is_member_of_group(gid uuid)
returns boolean as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$ language sql security definer stable;

create or replace function public.is_admin_of_group(gid uuid)
returns boolean as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- =============================================================================
-- TABLES (committed schema)
-- =============================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  avatar_url   text,
  last_seen_at timestamptz default now(),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Prod-only columns on profiles (not in committed schema.sql):
alter table public.profiles add column if not exists location_building text;
alter table public.profiles add column if not exists location_room     text;
alter table public.profiles add column if not exists reputation_score  integer default 50;
alter table public.profiles add column if not exists flagged           boolean default false;

create table if not exists public.groups (
  id                uuid    primary key default gen_random_uuid(),
  name              text    not null,
  description       text,
  image_url         text,
  type              text    not null default 'friends' check (type in ('friends', 'campus_org')),
  is_private        boolean not null default false,
  join_code         text,
  join_password     text,
  has_join_password boolean not null default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create unique index if not exists groups_join_code_unique
  on public.groups (join_code)
  where join_code is not null;

create table if not exists public.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'editor', 'member')),
  joined_at timestamptz default now(),
  unique(group_id, user_id)
);

create table if not exists public.group_invites (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by      uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at      timestamptz default now(),
  unique(group_id, invited_user_id)
);

create table if not exists public.group_join_requests (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz default now(),
  unique(group_id, user_id)
);

create index if not exists group_members_group_id_idx        on public.group_members(group_id);
create index if not exists group_members_user_id_idx         on public.group_members(user_id);
create index if not exists group_invites_invited_user_id_idx on public.group_invites(invited_user_id);
create index if not exists group_join_requests_group_id_idx  on public.group_join_requests(group_id);
create index if not exists group_join_requests_user_id_idx   on public.group_join_requests(user_id);

-- =============================================================================
-- TRIGGERS (committed schema)
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.manage_group_join_code()
returns trigger as $$
declare
  v_code text;
begin
  if new.is_private = true and new.join_code is null then
    loop
      v_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
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
$$ language plpgsql;

drop trigger if exists set_private_group_join_code on public.groups;
create trigger set_private_group_join_code
  before insert or update of is_private on public.groups
  for each row execute function public.manage_group_join_code();

create or replace function public.sync_has_join_password()
returns trigger as $$
begin
  new.has_join_password := (new.join_password is not null and new.join_password <> '');
  return new;
end;
$$ language plpgsql;

drop trigger if exists sync_group_has_join_password on public.groups;
create trigger sync_group_has_join_password
  before insert or update of join_password on public.groups
  for each row execute function public.sync_has_join_password();

-- =============================================================================
-- ROW LEVEL SECURITY — committed schema (preserves known bugs as-is)
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.groups              enable row level security;
alter table public.group_members       enable row level security;
alter table public.group_invites       enable row level security;
alter table public.group_join_requests enable row level security;

-- ── profiles ─────────────────────────────────────────────────────────────────

drop policy if exists "Users can view own profile"                              on public.profiles;
drop policy if exists "Users can update own profile"                            on public.profiles;
drop policy if exists "Members can view profiles of users in shared groups"    on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Members can view profiles of users in shared groups"
  on public.profiles for select
  using (
    exists (
      select 1 from public.group_members gm_self
      inner join public.group_members gm_other
        on gm_self.group_id = gm_other.group_id
        and gm_other.user_id = profiles.id
      where gm_self.user_id = auth.uid()
    )
  );

-- ── groups ───────────────────────────────────────────────────────────────────

drop policy if exists "Members can view groups they belong to"                  on public.groups;
drop policy if exists "Users can view groups they're invited to"                on public.groups;
drop policy if exists "Authenticated users can browse public groups"            on public.groups;
drop policy if exists "Authenticated users can browse all groups"               on public.groups;
drop policy if exists "Authenticated users can create groups"                   on public.groups;
drop policy if exists "Admins or editors can update their groups"               on public.groups;
drop policy if exists "Admins can delete their groups"                          on public.groups;

create policy "Members can view groups they belong to"
  on public.groups for select
  using (public.is_member_of_group(id));

create policy "Users can view groups they're invited to"
  on public.groups for select
  using (
    exists (
      select 1 from public.group_invites
      where group_invites.group_id = groups.id
        and group_invites.invited_user_id = auth.uid()
        and group_invites.status = 'pending'
    )
  );

create policy "Authenticated users can browse public groups"
  on public.groups for select
  using (auth.uid() is not null and is_private = false);

create policy "Authenticated users can create groups"
  on public.groups for insert
  with check (auth.uid() is not null);

create policy "Admins or editors can update their groups"
  on public.groups for update
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = groups.id
        and group_members.user_id = auth.uid()
        and group_members.role in ('admin', 'editor')
    )
  );

create policy "Admins can delete their groups"
  on public.groups for delete
  using (public.is_admin_of_group(id));

-- ── group_members (self-insert policy OR's with admin-insert — fixed in 0003)

drop policy if exists "Members can view group members"                          on public.group_members;
drop policy if exists "Admins can add members"                                  on public.group_members;
drop policy if exists "Users can join groups (first member becomes admin)"      on public.group_members;
drop policy if exists "Admins can update group member roles"                    on public.group_members;
drop policy if exists "Users can leave groups; admins can remove members"      on public.group_members;

create policy "Members can view group members"
  on public.group_members for select
  using (public.is_member_of_group(group_id));

create policy "Admins can add members"
  on public.group_members for insert
  with check (public.is_admin_of_group(group_id));

create policy "Users can join groups (first member becomes admin)"
  on public.group_members for insert
  with check (auth.uid() = user_id);

create policy "Admins can update group member roles"
  on public.group_members for update
  using  (public.is_admin_of_group(group_id))
  with check (public.is_admin_of_group(group_id));

create policy "Users can leave groups; admins can remove members"
  on public.group_members for delete
  using (auth.uid() = user_id or public.is_admin_of_group(group_id));

-- ── group_invites ────────────────────────────────────────────────────────────

drop policy if exists "Users can view invites sent to them"                     on public.group_invites;
drop policy if exists "Group admins can create invites"                         on public.group_invites;
drop policy if exists "Invitees can update their invite status"                 on public.group_invites;

create policy "Users can view invites sent to them"
  on public.group_invites for select
  using (invited_user_id = auth.uid());

create policy "Group admins can create invites"
  on public.group_invites for insert
  with check (public.is_admin_of_group(group_id));

create policy "Invitees can update their invite status"
  on public.group_invites for update
  using (invited_user_id = auth.uid());

-- ── group_join_requests ──────────────────────────────────────────────────────

drop policy if exists "Users can view own join requests or group admins can view" on public.group_join_requests;
drop policy if exists "Users can create join requests for themselves"             on public.group_join_requests;
drop policy if exists "Users can cancel own pending join requests"                on public.group_join_requests;

create policy "Users can view own join requests or group admins can view"
  on public.group_join_requests for select
  using (user_id = auth.uid() or public.is_admin_of_group(group_id));

create policy "Users can create join requests for themselves"
  on public.group_join_requests for insert
  with check (auth.uid() = user_id);

create policy "Users can cancel own pending join requests"
  on public.group_join_requests for delete
  using (auth.uid() = user_id and status = 'pending');

-- INTENTIONALLY no UPDATE policy on group_join_requests. Status changes only
-- via the SECURITY DEFINER RPC `handle_join_request`. Adding a permissive
-- UPDATE policy here would let requesters self-approve.

-- =============================================================================
-- RPCs (committed schema, verbatim)
-- =============================================================================

create or replace function public.create_group(
  p_name          text,
  p_description   text    default null,
  p_type          text    default 'friends',
  p_is_private    boolean default false,
  p_join_password text    default null,
  p_image_url     text    default null
)
returns json
language plpgsql security definer
as $$
declare
  v_group_id uuid;
begin
  insert into public.groups (name, description, type, is_private, join_password, image_url)
  values (p_name, p_description, p_type, p_is_private, p_join_password, p_image_url)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'admin');

  return json_build_object('id', v_group_id);
end;
$$;

grant execute on function public.create_group(text, text, text, boolean, text, text) to authenticated;

create or replace function public.join_group_by_code(p_code text)
returns json
language plpgsql security definer
as $$
declare
  v_group_id   uuid;
  v_group_name text;
begin
  p_code := upper(trim(p_code));

  select id, name into v_group_id, v_group_name
  from public.groups
  where join_code = p_code and is_private = true;

  if v_group_id is null then
    return json_build_object('error', 'invalid_code');
  end if;

  if exists (
    select 1 from public.group_members
    where group_id = v_group_id and user_id = auth.uid()
  ) then
    return json_build_object('error', 'already_member', 'group_name', v_group_name);
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'member');

  return json_build_object('success', true, 'group_name', v_group_name);
end;
$$;

grant execute on function public.join_group_by_code(text) to authenticated;

create or replace function public.join_friend_group(p_group_id uuid, p_password text default null)
returns json
language plpgsql security definer
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

  if v_join_password is not null and v_join_password <> ''
     and (p_password is null or v_join_password <> p_password)
  then
    return json_build_object('error', 'incorrect_password');
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

grant execute on function public.join_friend_group(uuid, text) to authenticated;

create or replace function public.handle_join_request(p_request_id uuid, p_action text)
returns json
language plpgsql security definer
as $$
declare
  v_group_id uuid;
  v_user_id  uuid;
begin
  select group_id, user_id into v_group_id, v_user_id
  from public.group_join_requests
  where id = p_request_id and status = 'pending';

  if v_group_id is null then
    return json_build_object('error', 'not_found');
  end if;

  if not public.is_admin_of_group(v_group_id) then
    return json_build_object('error', 'not_authorized');
  end if;

  if p_action = 'approve' then
    update public.group_join_requests set status = 'approved' where id = p_request_id;
    insert into public.group_members (group_id, user_id, role)
    values (v_group_id, v_user_id, 'member')
    on conflict (group_id, user_id) do nothing;
    return json_build_object('success', true, 'action', 'approved');

  elsif p_action = 'decline' then
    update public.group_join_requests set status = 'declined' where id = p_request_id;
    return json_build_object('success', true, 'action', 'declined');

  else
    return json_build_object('error', 'invalid_action');
  end if;
end;
$$;

grant execute on function public.handle_join_request(uuid, text) to authenticated;

create or replace function public.regenerate_group_join_code(p_group_id uuid)
returns json
language plpgsql security definer
as $$
declare
  v_new_code   text;
  v_is_private boolean;
begin
  select is_private into v_is_private from public.groups where id = p_group_id;

  if not v_is_private then
    return json_build_object('error', 'not_private');
  end if;

  if not public.is_admin_of_group(p_group_id) then
    return json_build_object('error', 'not_authorized');
  end if;

  loop
    v_new_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    exit when not exists (
      select 1 from public.groups where join_code = v_new_code and id <> p_group_id
    );
  end loop;

  update public.groups set join_code = v_new_code where id = p_group_id;
  return json_build_object('success', true, 'join_code', v_new_code);
end;
$$;

grant execute on function public.regenerate_group_join_code(uuid) to authenticated;

create or replace function public.get_my_join_requests()
returns table(group_id uuid, status text)
language sql security definer stable
as $$
  select group_id, status
  from public.group_join_requests
  where user_id = auth.uid();
$$;

grant execute on function public.get_my_join_requests() to authenticated;

create or replace function public.get_group_join_requests(p_group_id uuid)
returns table(id uuid, user_id uuid, full_name text, created_at timestamptz)
language plpgsql security definer stable
as $$
begin
  if not public.is_admin_of_group(p_group_id) then
    return;
  end if;

  return query
    select gjr.id, gjr.user_id, p.full_name, gjr.created_at
    from public.group_join_requests gjr
    left join public.profiles p on p.id = gjr.user_id
    where gjr.group_id = p_group_id and gjr.status = 'pending'
    order by gjr.created_at asc;
end;
$$;

grant execute on function public.get_group_join_requests(uuid) to authenticated;

create or replace function public.search_users_for_invite(p_group_id uuid, p_query text)
returns table(user_id uuid, full_name text, avatar_url text)
language plpgsql security definer stable
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

  return query
    select p.id, p.full_name, p.avatar_url
    from public.profiles p
    where p.full_name ilike '%' || v_query || '%'
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

grant execute on function public.search_users_for_invite(uuid, text) to authenticated;

create or replace function public.invite_user_to_group(p_group_id uuid, p_user_id uuid)
returns json
language plpgsql security definer
as $$
declare
  v_invite_id uuid;
  v_existing_status text;
begin
  if not public.is_admin_of_group(p_group_id) then
    return json_build_object('error', 'not_authorized');
  end if;

  if p_user_id = auth.uid() then
    return json_build_object('error', 'cannot_invite_self');
  end if;

  if exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  ) then
    return json_build_object('error', 'already_member');
  end if;

  select id, status into v_invite_id, v_existing_status
  from public.group_invites
  where group_id = p_group_id and invited_user_id = p_user_id;

  if v_invite_id is not null then
    if v_existing_status = 'pending' then
      return json_build_object('error', 'already_invited');
    end if;
    update public.group_invites
       set status = 'pending', invited_by = auth.uid(), created_at = now()
     where id = v_invite_id;
    return json_build_object('success', true, 'invite_id', v_invite_id);
  end if;

  insert into public.group_invites (group_id, invited_user_id, invited_by)
  values (p_group_id, p_user_id, auth.uid())
  returning id into v_invite_id;

  return json_build_object('success', true, 'invite_id', v_invite_id);
end;
$$;

grant execute on function public.invite_user_to_group(uuid, uuid) to authenticated;

create or replace function public.get_group_invites(p_group_id uuid)
returns table(
  invite_id  uuid,
  user_id    uuid,
  full_name  text,
  avatar_url text,
  created_at timestamptz
)
language plpgsql security definer stable
as $$
begin
  if not public.is_admin_of_group(p_group_id) then
    return;
  end if;

  return query
    select gi.id, gi.invited_user_id, p.full_name, p.avatar_url, gi.created_at
    from public.group_invites gi
    left join public.profiles p on p.id = gi.invited_user_id
    where gi.group_id = p_group_id and gi.status = 'pending'
    order by gi.created_at desc;
end;
$$;

grant execute on function public.get_group_invites(uuid) to authenticated;

create or replace function public.revoke_group_invite(p_invite_id uuid)
returns json
language plpgsql security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id
  from public.group_invites
  where id = p_invite_id and status = 'pending';

  if v_group_id is null then
    return json_build_object('error', 'not_found');
  end if;

  if not public.is_admin_of_group(v_group_id) then
    return json_build_object('error', 'not_authorized');
  end if;

  delete from public.group_invites where id = p_invite_id;
  return json_build_object('success', true);
end;
$$;

grant execute on function public.revoke_group_invite(uuid) to authenticated;

create or replace function public.get_my_group_invites()
returns table(
  invite_id         uuid,
  group_id          uuid,
  group_name        text,
  group_description text,
  group_image_url   text,
  group_type        text,
  group_is_private  boolean,
  inviter_name      text,
  created_at        timestamptz
)
language plpgsql security definer stable
as $$
begin
  return query
    select
      gi.id,
      gi.group_id,
      g.name,
      g.description,
      g.image_url,
      g.type,
      g.is_private,
      p.full_name,
      gi.created_at
    from public.group_invites gi
    join public.groups g on g.id = gi.group_id
    left join public.profiles p on p.id = gi.invited_by
    where gi.invited_user_id = auth.uid()
      and gi.status = 'pending'
    order by gi.created_at desc;
end;
$$;

grant execute on function public.get_my_group_invites() to authenticated;

create or replace function public.respond_to_group_invite(p_invite_id uuid, p_action text)
returns json
language plpgsql security definer
as $$
declare
  v_group_id   uuid;
  v_group_name text;
begin
  select gi.group_id, g.name into v_group_id, v_group_name
  from public.group_invites gi
  join public.groups g on g.id = gi.group_id
  where gi.id = p_invite_id
    and gi.invited_user_id = auth.uid()
    and gi.status = 'pending';

  if v_group_id is null then
    return json_build_object('error', 'not_found');
  end if;

  if p_action = 'accept' then
    update public.group_invites set status = 'accepted' where id = p_invite_id;
    insert into public.group_members (group_id, user_id, role)
    values (v_group_id, auth.uid(), 'member')
    on conflict (group_id, user_id) do nothing;
    return json_build_object('success', true, 'action', 'accepted', 'group_name', v_group_name);

  elsif p_action = 'decline' then
    update public.group_invites set status = 'declined' where id = p_invite_id;
    return json_build_object('success', true, 'action', 'declined');

  else
    return json_build_object('error', 'invalid_action');
  end if;
end;
$$;

grant execute on function public.respond_to_group_invite(uuid, text) to authenticated;

create or replace function public.get_group_member_counts()
returns table(group_id uuid, member_count bigint)
language sql security definer stable
as $$
  select gm.group_id, count(*)::bigint
  from public.group_members gm
  group by gm.group_id;
$$;

grant execute on function public.get_group_member_counts() to authenticated;

-- =============================================================================
-- STORAGE (committed schema — known bug preserved; tightened in 0009)
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('group-images', 'group-images', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload group images" on storage.objects;
drop policy if exists "Anyone can view group images"                 on storage.objects;

create policy "Authenticated users can upload group images"
  on storage.objects for insert
  with check (
    bucket_id = 'group-images'
    and auth.role() = 'authenticated'
  );

create policy "Anyone can view group images"
  on storage.objects for select
  using (bucket_id = 'group-images');

-- =============================================================================
-- Prod-only tables and policy drift (from live dump 2026-05-16)
-- Preserves prod state verbatim, including: duplicate FKs on friends, text
-- event ids, location_shares with no created_at, missing WITH CHECK on
-- several UPDATE policies, and the world-readable profile policy.
-- =============================================================================

-- ── floors ──────────────────────────────────────────────────────────────────
create table if not exists public.floors (
  id              uuid primary key default gen_random_uuid(),
  building_id     uuid,
  floor_number    integer not null,
  floor_plan_url  text,
  created_at      timestamp default now()
);
-- floors.building_id -> public.buildings(id) -- TODO: confirm in next dump pass
-- No RLS policies observed on floors as of 2026-05-16.

-- ── friends ─────────────────────────────────────────────────────────────────
create table if not exists public.friends (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  friend_id   uuid,
  status      text default 'pending',
  created_at  timestamp default now()
);

-- Prod has 4 FKs on friends (two redundant pairs: to auth.users and to profiles).
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'friends_user_id_fkey'
  ) then
    alter table public.friends
      add constraint friends_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'friends_friend_id_fkey'
  ) then
    alter table public.friends
      add constraint friends_friend_id_fkey
      foreign key (friend_id) references auth.users(id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'friends_user_id_fkey1'
  ) then
    alter table public.friends
      add constraint friends_user_id_fkey1
      foreign key (user_id) references public.profiles(id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'friends_friend_id_fkey1'
  ) then
    alter table public.friends
      add constraint friends_friend_id_fkey1
      foreign key (friend_id) references public.profiles(id);
  end if;
end $$;

alter table public.friends enable row level security;

drop policy if exists "Users can view their own friendships"  on public.friends;
drop policy if exists "Users can send friend requests"        on public.friends;
drop policy if exists "Users can accept friend requests"      on public.friends;
drop policy if exists "Users can remove friendships"          on public.friends;

create policy "Users can view their own friendships"
  on public.friends for select
  using ((auth.uid() = user_id) or (auth.uid() = friend_id));

create policy "Users can send friend requests"
  on public.friends for insert
  with check (auth.uid() = user_id);

-- No WITH CHECK in prod (fixed in 0011).
create policy "Users can accept friend requests"
  on public.friends for update
  using (auth.uid() = friend_id);

create policy "Users can remove friendships"
  on public.friends for delete
  using ((auth.uid() = user_id) or (auth.uid() = friend_id));

-- ── location_shares ─────────────────────────────────────────────────────────
create table if not exists public.location_shares (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid references auth.users(id) on delete cascade,
  viewer_id uuid references auth.users(id) on delete cascade,
  unique (owner_id, viewer_id)
);

alter table public.location_shares enable row level security;

drop policy if exists "owner or viewer" on public.location_shares;

-- FOR ALL with null WITH CHECK — exploitable (fixed in 0010).
create policy "owner or viewer"
  on public.location_shares for all
  using ((auth.uid() = owner_id) or (auth.uid() = viewer_id));

-- ── events ──────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id                 text primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  group_id           uuid,
  event_date         date not null,
  title              text not null,
  location           text,
  time               text not null,
  notify             boolean default false,
  notify_in_advance  integer,
  created_at         timestamptz not null default now()
);

alter table public.events enable row level security;

drop policy if exists "Users can view their own events"   on public.events;
drop policy if exists "Users can add their own events"    on public.events;
drop policy if exists "Users can update their own events" on public.events;
drop policy if exists "Users can delete their own events" on public.events;

create policy "Users can view their own events"
  on public.events for select using (auth.uid() = user_id);

create policy "Users can add their own events"
  on public.events for insert with check (auth.uid() = user_id);

-- No WITH CHECK in prod (fixed in 0008).
create policy "Users can update their own events"
  on public.events for update using (auth.uid() = user_id);

create policy "Users can delete their own events"
  on public.events for delete using (auth.uid() = user_id);

-- ── campus_alerts ───────────────────────────────────────────────────────────
create table if not exists public.campus_alerts (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in (
                 'building_closure','crowd','elevator_down',
                 'construction','hazard','other')),
  floor_id     uuid references public.floors(id),
  x            double precision not null,
  y            double precision not null,
  description  text,
  submitted_by uuid references public.profiles(id) on delete set null,
  status       text default 'active' check (status in ('active','expired','removed')),
  created_at   timestamptz default now(),
  expires_at   timestamptz not null
);

alter table public.campus_alerts enable row level security;

drop policy if exists "Anyone authenticated can view active alerts" on public.campus_alerts;
drop policy if exists "Authenticated users can submit alerts"       on public.campus_alerts;
drop policy if exists "Submitter can remove their own alert"        on public.campus_alerts;

create policy "Anyone authenticated can view active alerts"
  on public.campus_alerts for select
  using ((status = 'active') and (expires_at > now()));

create policy "Authenticated users can submit alerts"
  on public.campus_alerts for insert
  with check (submitted_by = auth.uid());

-- No WITH CHECK in prod (cosmetic; deferred).
create policy "Submitter can remove their own alert"
  on public.campus_alerts for update
  using (submitted_by = auth.uid());

-- ── alert_votes ─────────────────────────────────────────────────────────────
create table if not exists public.alert_votes (
  id         uuid primary key default gen_random_uuid(),
  alert_id   uuid references public.campus_alerts(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  vote       text check (vote in ('confirm','deny')),
  created_at timestamptz default now(),
  unique (alert_id, user_id)
);

alter table public.alert_votes enable row level security;

drop policy if exists "Anyone authenticated can view votes"  on public.alert_votes;
drop policy if exists "Users can only insert their own vote" on public.alert_votes;
drop policy if exists "Users can update their own vote"      on public.alert_votes;

create policy "Anyone authenticated can view votes"
  on public.alert_votes for select to authenticated using (true);

create policy "Users can only insert their own vote"
  on public.alert_votes for insert to authenticated
  with check (user_id = auth.uid());

-- No WITH CHECK in prod (cosmetic; deferred).
create policy "Users can update their own vote"
  on public.alert_votes for update to authenticated
  using (user_id = auth.uid());

-- ── profiles: world-readable SELECT policy (fixed in 0012) ──────────────────
drop policy if exists "Allow authenticated users to read all profiles" on public.profiles;
create policy "Allow authenticated users to read all profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- ── Out-of-audit-scope tables (existence + RLS posture only) ────────────────
-- Full column DDL not replicated (fresh-DB rebuilds import these via a
-- separate seed). Listed here so the baseline accounts for the whole schema.
--   buildings       PK(id); RLS off (fixed in 0002)
--   floors          PK(id), FK building_id; RLS off (fixed in 0002)
--   nodes           PK(id), FK floor_id; RLS off (fixed in 0002)
--   edges           PK(id), FKs from_node_id/to_node_id -> nodes; RLS off (fixed in 0002)
--   community_pins  PK(id), FKs floor_id, user_id; RLS on, 0 policies (locked, backlog)
--   user_locations  PK(id), UNIQUE(user_id), FKs floor_id, user_id; RLS on, 0 policies (locked, backlog)

commit;
