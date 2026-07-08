-- Fix: wall_messages' SELECT policy anti-joins against reports to hide
-- a message from its own reporter permanently — but that subquery runs
-- under the QUERYING user's own RLS, and reports only had a founder-
-- only SELECT policy. A non-founder reporter's own report was
-- therefore invisible even to themselves inside that subquery, so the
-- anti-join silently never matched and the message never actually hid.
create policy "a user can read their own reports"
on public.reports
for select
to authenticated
using (reporter_id = auth.uid());
