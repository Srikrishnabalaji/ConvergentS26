-- WavePoint Groups Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Note: If you have existing auth users, run this after to create their profiles:
--   insert into public.profiles (id, full_name)
--   select id, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
--   from auth.users
--   on conflict (id) do nothing;

-- =============================================================================
-- TABLES
-- =============================================================================

-- Profiles: extends auth.users with display info
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  last_seen_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Groups
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text,
  type text not null default 'friends' check (type in ('friends', 'campus_org')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Group members: users in groups
create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz default now(),
  unique(group_id, user_id)
);

-- Group invites: pending invitations
create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz default now()
);

-- Indexes for common queries
create index group_members_group_id_idx on public.group_members(group_id);
create index group_members_user_id_idx on public.group_members(user_id);
create index group_invites_invited_user_id_idx on public.group_invites(invited_user_id);

-- =============================================================================
-- TRIGGER: Auto-create profile on signup
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;

-- Profiles: users can read/update own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Groups: members can read; admins can update
create policy "Members can view groups they belong to"
  on public.groups for select
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = groups.id
        and group_members.user_id = auth.uid()
    )
  );

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

create policy "Authenticated users can create groups"
  on public.groups for insert
  with check (auth.uid() is not null);

create policy "Admins can update their groups"
  on public.groups for update
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = groups.id
        and group_members.user_id = auth.uid()
        and group_members.role = 'admin'
    )
  );

-- Group members: members can read; admins can manage
create policy "Members can view group members"
  on public.group_members for select
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
    )
  );

create policy "Admins can add members"
  on public.group_members for insert
  with check (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

create policy "Users can join groups (first member becomes admin)"
  on public.group_members for insert
  with check (auth.uid() = user_id);

create policy "Users can leave groups; admins can remove members"
  on public.group_members for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- Group invites: invitees can read/update their invites; admins can create
create policy "Users can view invites sent to them"
  on public.group_invites for select
  using (invited_user_id = auth.uid());

create policy "Group admins can create invites"
  on public.group_invites for insert
  with check (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_invites.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

create policy "Invitees can update their invite status"
  on public.group_invites for update
  using (invited_user_id = auth.uid());
