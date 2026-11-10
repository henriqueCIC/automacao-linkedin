GRANT SELECT ON public.cron_secrets TO authenticated;

DROP POLICY IF EXISTS "cron_secrets_service_role_only" ON public.cron_secrets;

CREATE POLICY "cron_secrets_block_users" ON public.cron_secrets
FOR SELECT
TO authenticated
USING (false);

CREATE POLICY "cron_secrets_block_users_all" ON public.cron_secrets
FOR ALL
TO anon
USING (false)
WITH CHECK (false);