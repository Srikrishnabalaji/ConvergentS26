-- 0012_restrict_profile_visibility.sql
-- Drop the world-readable profile policy and add narrow ones for the flows
-- that need cross-user profile reads outside a shared group: friend-graph
-- counterparties (pending or accepted) and location-share counterparties.
-- The committed "own profile" and "shared group members" policies stay.

begin;

drop policy if exists "Allow authenticated users to read all profiles" on public.profiles;

drop policy if exists "View profiles of friend-graph counterparties"   on public.profiles;
drop policy if exists "View profiles of location-share counterparties" on public.profiles;

create policy "View profiles of friend-graph counterparties"
  on public.profiles for select
  using (
    exists (
      select 1 from public.friends f
      where (f.user_id   = auth.uid() and f.friend_id = profiles.id)
         or (f.friend_id = auth.uid() and f.user_id   = profiles.id)
    )
  );

create policy "View profiles of location-share counterparties"
  on public.profiles for select
  using (
    exists (
      select 1 from public.location_shares ls
      where (ls.owner_id  = auth.uid() and ls.viewer_id = profiles.id)
         or (ls.viewer_id = auth.uid() and ls.owner_id  = profiles.id)
    )
  );

commit;
