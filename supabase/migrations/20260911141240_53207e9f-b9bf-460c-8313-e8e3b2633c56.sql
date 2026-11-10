CREATE TABLE public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  account_login text,
  reconnect_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role;
ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER app_user_connections_updated_at
  BEFORE UPDATE ON public.app_user_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.automation_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  daily_time time NOT NULL DEFAULT '18:00',
  timezone text NOT NULL DEFAULT 'America/Bahia',
  default_tone text NOT NULL DEFAULT 'profissional',
  max_commits_per_day integer NOT NULL DEFAULT 15,
  notify_desktop boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT false,
  last_run_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_settings TO authenticated;
GRANT ALL ON public.automation_settings TO service_role;
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY automation_settings_own ON public.automation_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER automation_settings_updated_at
  BEFORE UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger text NOT NULL DEFAULT 'manual',
  since_at timestamptz,
  until_at timestamptz NOT NULL DEFAULT now(),
  commits_found integer NOT NULL DEFAULT 0,
  repositories text[] NOT NULL DEFAULT '{}',
  day_entry_id uuid REFERENCES public.day_entries(id) ON DELETE SET NULL,
  post_draft_id uuid REFERENCES public.post_drafts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ok',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_runs TO authenticated;
GRANT ALL ON public.collection_runs TO service_role;
ALTER TABLE public.collection_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_runs_own ON public.collection_runs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX collection_runs_user_created_idx ON public.collection_runs (user_id, created_at DESC);

CREATE TRIGGER collection_runs_updated_at
  BEFORE UPDATE ON public.collection_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.seen_commits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo_full_name text NOT NULL,
  commit_sha text NOT NULL,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, repo_full_name, commit_sha)
);

GRANT SELECT, INSERT, DELETE ON public.seen_commits TO authenticated;
GRANT ALL ON public.seen_commits TO service_role;
ALTER TABLE public.seen_commits ENABLE ROW LEVEL SECURITY;
CREATE POLICY seen_commits_own ON public.seen_commits
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
