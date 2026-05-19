-- 0010_fix_location_shares_policy.sql
-- The FOR ALL policy had null WITH CHECK, so a user could insert a share with
-- owner_id = anyone and viewer_id = themselves. Split into per-command
-- policies; INSERT restricted to owner_id = auth.uid().

begin;

drop policy if exists "owner or viewer" on public.location_shares;

create policy "Read location shares involving me"
  on public.location_shares for select
  using ((owner_id = auth.uid()) or (viewer_id = auth.uid()));

create policy "Owners grant location shares"
  on public.location_shares for insert
  with check (owner_id = auth.uid());

create policy "Owner or viewer can revoke a location share"
  on public.location_shares for delete
  using ((owner_id = auth.uid()) or (viewer_id = auth.uid()));

commit;
