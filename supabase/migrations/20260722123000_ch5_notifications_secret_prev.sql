-- CH5 job 3 (22 July): the NOTIFICATIONS_SECRET rotation, done without
-- breaking the unsubscribe links already sitting in sent emails. Those
-- links carry an HMAC of the OLD secret, so the rotation keeps exactly
-- one previous value alive in Vault ('notifications_secret_prev') and
-- the unsubscribe function verifies current-then-prev. Everything else
-- (cron auth headers, compose/send verification, newly signed links)
-- reads the CURRENT value live from Vault at call time — so the
-- rotation itself is one vault.update_secret with effectively zero
-- pause, done as a live operation (secret VALUES never enter the repo).
--
-- Same S1 hygiene as get_notifications_secret: definer, pinned path,
-- service_role only, explicit revokes.
create or replace function public.get_notifications_secret_prev()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret_prev';
$$;

revoke all on function public.get_notifications_secret_prev() from public;
revoke all on function public.get_notifications_secret_prev() from anon;
revoke all on function public.get_notifications_secret_prev() from authenticated;
grant execute on function public.get_notifications_secret_prev() to service_role;
