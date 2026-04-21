-- WavePoint Complete Schema
-- Run this in Supabase SQL Editor on a NEW / EMPTY database only.
-- For an existing database that already has base tables, run groups-redesign.sql
-- to apply join codes, private groups, and all RPCs.
--
-- To backfill profiles for existing auth users after running this:
--   insert into public.profiles (id, full_name)
--   select id, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
--   from auth.users
--   on conflict (id) do nothing;

-- =============================================================================
-- HELPER FUNCTIONS
-- Must be created first — RLS policies below reference them.
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
-- TABLES
-- =============================================================================

-- Profiles: extends auth.users with display info
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  avatar_url   text,
  last_seen_at timestamptz default now(),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Groups
create table public.groups (
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

create unique index groups_join_code_unique on public.groups (join_code)
  where join_code is not null;

-- Group members
create table public.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'editor', 'member')),
  joined_at timestamptz default now(),
  unique(group_id, user_id)
);

-- Group invites: pending invitations
create table public.group_invites (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by      uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at      timestamptz default now()
);

-- Group join requests: campus org approval queue
create table public.group_join_requests (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz default now(),
  unique(group_id, user_id)
);

-- Indexes
create index group_members_group_id_idx        on public.group_members(group_id);
create index group_members_user_id_idx         on public.group_members(user_id);
create index group_invites_invited_user_id_idx on public.group_invites(invited_user_id);
create index group_join_requests_group_id_idx  on public.group_join_requests(group_id);
create index group_join_requests_user_id_idx   on public.group_join_requests(user_id);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-create profile on signup
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto-generate join_code for private groups; clear it when made public
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

create trigger set_private_group_join_code
  before insert or update of is_private on public.groups
  for each row execute function public.manage_group_join_code();

-- Keep has_join_password in sync with join_password
create or replace function public.sync_has_join_password()
returns trigger as $$
begin
  new.has_join_password := (new.join_password is not null and new.join_password <> '');
  return new;
end;
$$ language plpgsql;

create trigger sync_group_has_join_password
  before insert or update of join_password on public.groups
  for each row execute function public.sync_has_join_password();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.groups              enable row level security;
alter table public.group_members       enable row level security;
alter table public.group_invites       enable row level security;
alter table public.group_join_requests enable row level security;

-- ── Profiles ─────────────────────────────────────────────────────────────────

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

-- ── Groups ───────────────────────────────────────────────────────────────────

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

-- ── Group members (non-recursive — uses security definer helpers) ─────────────

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

-- ── Group invites ─────────────────────────────────────────────────────────────

create policy "Users can view invites sent to them"
  on public.group_invites for select
  using (invited_user_id = auth.uid());

create policy "Group admins can create invites"
  on public.group_invites for insert
  with check (public.is_admin_of_group(group_id));

create policy "Invitees can update their invite status"
  on public.group_invites for update
  using (invited_user_id = auth.uid());

-- ── Group join requests ───────────────────────────────────────────────────────

create policy "Users can view own join requests or group admins can view"
  on public.group_join_requests for select
  using (user_id = auth.uid() or public.is_admin_of_group(group_id));

create policy "Users can create join requests for themselves"
  on public.group_join_requests for insert
  with check (auth.uid() = user_id);

create policy "Users can cancel own pending join requests"
  on public.group_join_requests for delete
  using (auth.uid() = user_id and status = 'pending');

-- =============================================================================
-- RPCs
-- =============================================================================

-- Atomically create a group and add the creator as admin.
-- (Needed so RETURNING on private groups doesn't fail the SELECT RLS check.)
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

-- Join a private group by code
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

-- Join a public friend group (verifies password if set)
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

-- Approve or decline a campus org join request (admin only)
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

-- Regenerate join code for a private group (admin only)
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

-- Get the current user's join requests
create or replace function public.get_my_join_requests()
returns table(group_id uuid, status text)
language sql security definer stable
as $$
  select group_id, status
  from public.group_join_requests
  where user_id = auth.uid();
$$;

grant execute on function public.get_my_join_requests() to authenticated;

-- Get pending join requests for a group (admin only)
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

-- Member counts for all groups (bypasses RLS so browse UI shows correct counts)
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
-- STORAGE
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('group-images', 'group-images', true)
on conflict (id) do nothing;

create policy "Authenticated users can upload group images"
  on storage.objects for insert
  with check (
    bucket_id = 'group-images'
    and auth.role() = 'authenticated'
  );

create policy "Anyone can view group images"
  on storage.objects for select
  using (bucket_id = 'group-images');
