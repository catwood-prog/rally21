create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Shared secret the sender edge function checks on every invocation (it
-- runs with verify_jwt=false since pg_cron, not a real user, calls it —
-- see the edge function's own header check). Also reused to sign/verify
-- unsubscribe links. Never the service-role key itself, so it can be
-- rotated independently and never grants DB access if leaked.
select vault.create_secret(
  '3aeda5f28b6f47a33ae2f3ab2eab9167e69d7109b87ef5758e78e857846c3c67',
  'notifications_secret',
  'shared secret for the send-notifications cron trigger and unsubscribe link signing'
);

select cron.schedule(
  'send-notifications-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://vrmnzofownjutyyabcjw.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notifications-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
