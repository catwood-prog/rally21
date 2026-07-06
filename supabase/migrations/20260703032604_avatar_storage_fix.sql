-- Public buckets already serve objects via the public URL without needing
-- a SELECT policy; this policy only added the ability to LIST every file
-- path in the bucket via the API, which isn't needed and leaks user IDs.
drop policy "anyone can view avatars" on storage.objects;
