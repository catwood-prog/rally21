-- RETURNING id on the circles insert implicitly needs SELECT permission on
-- that row, but the membership granting that permission (via
-- is_member_of_circle) doesn't exist until the very next statement. Switch
-- to security definer (same proven pattern as join_circle_by_code) so the
-- function's own internal auth.uid()-scoped logic is what enforces
-- correctness, not RLS mid-function.
alter function public.create_circle(text, time) security definer;
