-- Fix: "infinite recursion detected in policy for relation group_members"
-- Run this in Supabase SQL Editor
--
-- The issue: RLS policies on group_members reference group_members in their
-- subqueries, causing recursion. We use SECURITY DEFINER functions to bypass RLS
-- for the lookup.

-- 1. Create helper functions (bypass RLS for the check)
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

-- 2. Drop the recursive policies on group_members (and recreated ones)
drop policy if exists "Members can view group members" on public.group_members;
drop policy if exists "Admins can add members" on public.group_members;
drop policy if exists "Users can join groups (first member becomes admin)" on public.group_members;
drop policy if exists "Users can leave groups; admins can remove members" on public.group_members;
drop policy if exists "Group admins can create invites" on public.group_invites;

-- 3. Recreate policies using the helper functions (no recursion)
create policy "Members can view group members"
  on public.group_members for select
  using (public.is_member_of_group(group_id));

create policy "Admins can add members"
  on public.group_members for insert
  with check (public.is_admin_of_group(group_id));

create policy "Users can join groups (first member becomes admin)"
  on public.group_members for insert
  with check (auth.uid() = user_id);

create policy "Users can leave groups; admins can remove members"
  on public.group_members for delete
  using (auth.uid() = user_id or public.is_admin_of_group(group_id));

create policy "Group admins can create invites"
  on public.group_invites for insert
  with check (public.is_admin_of_group(group_id));
