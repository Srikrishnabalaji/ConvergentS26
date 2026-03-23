-- Run in Supabase SQL Editor after schema.sql
-- 1. Allows browsing all groups (for Join/discover section)
-- 2. Creates storage bucket for group images

-- Allow authenticated users to browse all groups
create policy "Authenticated users can browse all groups"
  on public.groups for select
  using (auth.uid() is not null);

-- Create public storage bucket for group images
insert into storage.buckets (id, name, public)
values ('group-images', 'group-images', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload
create policy "Authenticated users can upload group images"
  on storage.objects for insert
  with check (
    bucket_id = 'group-images'
    and auth.role() = 'authenticated'
  );

-- Anyone can view (public bucket)
create policy "Anyone can view group images"
  on storage.objects for select
  using (bucket_id = 'group-images');
