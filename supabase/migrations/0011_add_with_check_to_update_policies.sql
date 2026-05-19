-- 0011_add_with_check_to_update_policies.sql
-- friends.accept and group_invites.update had USING but null WITH CHECK,
-- letting callers rewrite identity columns during the update. Mirror USING
-- into WITH CHECK. The other UPDATE policies missing WITH CHECK
-- (alert_votes/campus_alerts/groups/profiles) are cosmetic; deferred.

begin;

drop policy if exists "Users can accept friend requests" on public.friends;

create policy "Users can accept friend requests"
  on public.friends for update
  using      (auth.uid() = friend_id)
  with check (auth.uid() = friend_id);

drop policy if exists "Invitees can update their invite status" on public.group_invites;

create policy "Invitees can update their invite status"
  on public.group_invites for update
  using      (invited_user_id = auth.uid())
  with check (invited_user_id = auth.uid());

commit;
