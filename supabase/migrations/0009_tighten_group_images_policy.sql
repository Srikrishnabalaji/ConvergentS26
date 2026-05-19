-- 0009_tighten_group_images_policy.sql
-- group-images bucket accepted any path / any MIME / any size from any user.
-- Restrict to <auth.uid()>/... path, jpeg/png/webp, <= 5 MB. Read stays
-- public (avatars).

begin;

drop policy if exists "Authenticated users can upload group images" on storage.objects;
drop policy if exists "Authenticated users can update own group images" on storage.objects;
drop policy if exists "Authenticated users can delete own group images" on storage.objects;

create policy "Authenticated users can upload group images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and coalesce((metadata->>'mimetype'), '') in ('image/jpeg', 'image/png', 'image/webp')
    and coalesce((metadata->>'size')::bigint, 0) > 0
    and coalesce((metadata->>'size')::bigint, 0) <= 5 * 1024 * 1024
  );

create policy "Authenticated users can update own group images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and coalesce((metadata->>'mimetype'), '') in ('image/jpeg', 'image/png', 'image/webp')
    and coalesce((metadata->>'size')::bigint, 0) <= 5 * 1024 * 1024
  );

create policy "Authenticated users can delete own group images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
