select cron.schedule(
  'compose-blueprint-weekly',
  '0 20 * * 0',
  $$
  select net.http_post(
    url := 'https://vrmnzofownjutyyabcjw.supabase.co/functions/v1/compose-blueprint',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notifications-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
