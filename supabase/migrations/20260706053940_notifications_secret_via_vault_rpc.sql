-- The Deno-env-secret approach for NOTIFICATIONS_SECRET proved fragile
-- (repeated manual copy/paste mismatches). Both the cron job and the edge
-- functions now read the one value already stored in Vault instead, so
-- there is exactly one source of truth and no manual transcription step.
create or replace function public.get_notifications_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret';
$$;

revoke all on function public.get_notifications_secret() from public, anon, authenticated;
grant execute on function public.get_notifications_secret() to service_role;
