CREATE POLICY "app_user_connections_service_role_only" ON public.app_user_connections
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);