-- Supabase Dashboard: enable pg_cron, pg_net, Vault first.
-- Create Vault secrets via Dashboard (not source code):
-- nail_app_url = https://YOUR-PROJECT.vercel.app
-- nail_cron_secret = the exact CRON_SECRET from Vercel
-- Run once. For repeated setup, unschedule the existing nail-reminders job first.
select cron.schedule('nail-reminders','* * * * *',$$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='nail_app_url') || '/api/index?action=cron',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='nail_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$$);
