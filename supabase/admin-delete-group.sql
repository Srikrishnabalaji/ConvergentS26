-- Allow admins to delete their groups
-- Run this in Supabase SQL Editor

drop policy if exists "Admins can delete their groups" on public.groups;
create policy "Admins can delete their groups"
  on public.groups for delete
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = groups.id
        and group_members.user_id = auth.uid()
        and group_members.role = 'admin'
    )
  );
