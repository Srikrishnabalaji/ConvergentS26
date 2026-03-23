-- Fix: Member counts are 0 for groups you're not in (RLS blocks group_members)
-- Run this in Supabase SQL Editor
--
-- This RPC returns member counts for all groups, bypassing RLS.

create or replace function public.get_group_member_counts()
returns table (group_id uuid, member_count bigint)
language sql security definer stable
as $$
  select gm.group_id, count(*)::bigint
  from public.group_members gm
  group by gm.group_id;
$$;

grant execute on function public.get_group_member_counts() to authenticated;
