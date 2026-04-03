-- Allow users to read profiles of people who share a group (for member lists).
-- Run on an EXISTING database only (after add-group-description-editor.sql),
-- or use run-on-existing-database.sql for a single combined script.

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
