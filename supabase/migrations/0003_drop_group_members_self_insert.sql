-- 0003_drop_group_members_self_insert.sql
-- The self-insert policy OR'd with the admin-insert policy, letting any user
-- insert themselves as 'admin' into any group. All legitimate joins go through
-- SECURITY DEFINER RPCs, so this policy can be removed outright.

begin;

drop policy if exists "Users can join groups (first member becomes admin)"
  on public.group_members;

commit;
