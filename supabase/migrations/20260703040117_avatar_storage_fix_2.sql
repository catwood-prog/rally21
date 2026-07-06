-- Supabase Storage upsert needs SELECT permission (to check whether the
-- object already exists) in addition to INSERT/UPDATE. The earlier fix
-- dropped SELECT entirely to kill a "can list all files" lint, which
-- broke uploads outright. Scope SELECT to the user's own folder instead
-- of a bucket-wide grant, so upsert works without exposing other users'
-- file paths.
create policy "a user can view their own avatar"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
