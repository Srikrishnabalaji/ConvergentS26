-- Run in Supabase SQL Editor on an EXISTING database (tables already created).
-- Do NOT run schema.sql — it will fail with "relation profiles already exists".
-- Adds group description, editor role, and policies for editors/admins.
-- (Or use run-on-existing-database.sql for this + add-profiles-groupmates-read in one file.)

-- 1. Description on groups
alter table public.groups add column if not exists description text;

-- 2. Allow editor role on group members
alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members add constraint group_members_role_check
  check (role in ('admin', 'editor', 'member'));

-- 3. Replace groups update policy: admins or editors can update
drop policy if exists "Admins can update their groups" on public.groups;
create policy "Admins or editors can update their groups"
  on public.groups for update
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
        and gm.role in ('admin', 'editor')
    )
  );

-- 4. Admins can change member roles (promote/demote editors)
drop policy if exists "Admins can update group member roles" on public.group_members;
create policy "Admins can update group member roles"
  on public.group_members for update
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );
