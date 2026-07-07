-- DC1 (7 July): the "your data" screen lets a user delete a single
-- check-in (a completions row) and remove their own profile picture.
-- Neither table had an owner DELETE policy before this (reflections
-- deliberately still has none — out of scope, this screen never
-- deletes a reflection, only a completions row). Narrow, owner-scoped
-- only, nothing broader per CLAUDE.md's security convention.

create policy "a user can delete their own completion"
on public.completions
for delete
to authenticated
using (user_id = auth.uid());

create policy "a user can delete their own avatar"
on storage.objects
for delete
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
