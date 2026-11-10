ALTER TABLE public.cron_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_secrets_service_role_only" ON public.cron_secrets
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);