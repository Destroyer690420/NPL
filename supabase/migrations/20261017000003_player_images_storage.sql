-- ----------------------------------------------------------------------------
-- 20261017000003_player_images_storage.sql
--
-- Sets up the public storage bucket for player photos/avatars.
-- When player images are hosted directly in Supabase Storage, loading is
-- served over the Supabase CDN with instant response times and no reliance
-- on external hostnames or broken third-party links.
--
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor).
-- ----------------------------------------------------------------------------

-- 1. Create the public bucket if it does not already exist
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-images',
  'player-images',
  true,
  5242880, -- 5 MB limit per image
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

-- 2. Drop existing policies to ensure clean re-runnability
drop policy if exists "Public read player-images" on storage.objects;
drop policy if exists "Allow upload player-images" on storage.objects;
drop policy if exists "Allow update player-images" on storage.objects;

-- 3. Public read policy: anyone (all client browsers) can view player headshots
create policy "Public read player-images"
on storage.objects for select
using (bucket_id = 'player-images');

-- 4. Allow insert policy: permits uploading images into the player-images bucket
create policy "Allow upload player-images"
on storage.objects for insert
with check (bucket_id = 'player-images');

-- 5. Allow update policy: permits updating/overwriting player images
create policy "Allow update player-images"
on storage.objects for update
using (bucket_id = 'player-images')
with check (bucket_id = 'player-images');
