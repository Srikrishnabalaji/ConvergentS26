-- ============================================================================
-- Run this ONLY on a database that already has tables (profiles, groups, ...).
-- Do NOT run schema.sql on top of an existing project — it will error with
-- "relation profiles already exists".
--
-- Order: group description + editor role + policies, then profile read policy.
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS where appropriate.
-- ============================================================================

-- From add-group-description-editor.sql
alter table public.groups add column if not exists description text;

alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members add constraint group_members_role_check
  check (role in ('admin', 'editor', 'member'));

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

-- From add-profiles-groupmates-read.sql
drop policy if exists "Members can view profiles of users in shared groups" on public.profiles;

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
