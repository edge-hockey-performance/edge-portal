CREATE TABLE IF NOT EXISTS public.player_access (
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relationship text NOT NULL CHECK (relationship IN ('self', 'parent', 'guardian')),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  PRIMARY KEY (player_id, user_id)
);

ALTER TABLE public.player_access ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_access TO authenticated, service_role;
REVOKE ALL ON public.player_access FROM anon;

CREATE UNIQUE INDEX IF NOT EXISTS player_access_one_active_primary_idx
ON public.player_access(player_id)
WHERE is_primary = true AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS player_access_user_active_idx
ON public.player_access(user_id, player_id)
WHERE revoked_at IS NULL;

INSERT INTO public.player_access (
  player_id,
  user_id,
  relationship,
  is_primary,
  created_by
)
SELECT
  p.id,
  p.id,
  'self',
  true,
  p.id
FROM public.profiles AS p
JOIN auth.users AS u ON u.id = p.id
WHERE NOT private.is_staff(p.id)
ON CONFLICT (player_id, user_id) DO UPDATE
SET relationship = EXCLUDED.relationship,
    is_primary = EXCLUDED.is_primary,
    revoked_at = NULL;

CREATE OR REPLACE FUNCTION private.can_access_player(check_player uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.player_access AS pa
      WHERE pa.player_id = check_player
        AND pa.user_id = auth.uid()
        AND pa.revoked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION private.can_manage_player(check_player uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.player_access AS pa
      WHERE pa.player_id = check_player
        AND pa.user_id = auth.uid()
        AND pa.relationship IN ('self', 'parent', 'guardian')
        AND pa.revoked_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION private.can_access_player(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_manage_player(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_player(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_manage_player(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.player_access (
    player_id,
    user_id,
    relationship,
    is_primary,
    created_by
  )
  VALUES (
    NEW.id,
    NEW.id,
    'self',
    true,
    NEW.id
  )
  ON CONFLICT (player_id, user_id) DO UPDATE
  SET relationship = EXCLUDED.relationship,
      is_primary = EXCLUDED.is_primary,
      revoked_at = NULL;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin, service_role;

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT p.schemaname, p.tablename, p.policyname
    FROM pg_policies AS p
    WHERE p.schemaname = 'public'
      AND p.tablename IN (
        'profiles',
        'appointments',
        'sharpenings',
        'skate_log',
        'steel',
        'steel_history',
        'blade_reports',
        'player_access'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$$;

CREATE POLICY player_access_select_authorized
ON public.player_access
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR private.is_staff((SELECT auth.uid()))
);

CREATE POLICY player_access_insert_staff
ON public.player_access
FOR INSERT
TO authenticated
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY player_access_update_staff
ON public.player_access
FOR UPDATE
TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY player_access_delete_staff
ON public.player_access
FOR DELETE
TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY profiles_select_authorized
ON public.profiles
FOR SELECT
TO authenticated
USING (private.can_access_player(id));

CREATE POLICY profiles_insert_self
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY profiles_insert_staff
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY profiles_update_authorized
ON public.profiles
FOR UPDATE
TO authenticated
USING (private.can_manage_player(id))
WITH CHECK (private.can_manage_player(id));

CREATE POLICY appointments_select_authorized
ON public.appointments
FOR SELECT
TO authenticated
USING (private.can_access_player(player_id));

CREATE POLICY appointments_insert_authorized
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (private.can_manage_player(player_id));

CREATE POLICY appointments_update_staff
ON public.appointments
FOR UPDATE
TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY appointments_delete_staff
ON public.appointments
FOR DELETE
TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY sharpenings_select_authorized
ON public.sharpenings
FOR SELECT
TO authenticated
USING (private.can_access_player(player_id));

CREATE POLICY sharpenings_insert_staff
ON public.sharpenings
FOR INSERT
TO authenticated
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY sharpenings_update_staff
ON public.sharpenings
FOR UPDATE
TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY sharpenings_delete_staff
ON public.sharpenings
FOR DELETE
TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY skate_log_select_authorized
ON public.skate_log
FOR SELECT
TO authenticated
USING (private.can_access_player(player_id));

CREATE POLICY skate_log_insert_authorized
ON public.skate_log
FOR INSERT
TO authenticated
WITH CHECK (private.can_manage_player(player_id));

CREATE POLICY skate_log_update_authorized
ON public.skate_log
FOR UPDATE
TO authenticated
USING (private.can_manage_player(player_id))
WITH CHECK (private.can_manage_player(player_id));

CREATE POLICY skate_log_delete_authorized
ON public.skate_log
FOR DELETE
TO authenticated
USING (private.can_manage_player(player_id));

CREATE POLICY steel_select_authorized
ON public.steel
FOR SELECT
TO authenticated
USING (private.can_access_player(player_id));

CREATE POLICY steel_insert_staff
ON public.steel
FOR INSERT
TO authenticated
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY steel_update_staff
ON public.steel
FOR UPDATE
TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY steel_delete_staff
ON public.steel
FOR DELETE
TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY steel_history_select_authorized
ON public.steel_history
FOR SELECT
TO authenticated
USING (private.can_access_player(player_id));

CREATE POLICY steel_history_insert_authorized
ON public.steel_history
FOR INSERT
TO authenticated
WITH CHECK (private.can_manage_player(player_id));

CREATE POLICY steel_history_update_staff
ON public.steel_history
FOR UPDATE
TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY steel_history_delete_staff
ON public.steel_history
FOR DELETE
TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY blade_reports_select_authorized
ON public.blade_reports
FOR SELECT
TO authenticated
USING (private.can_access_player(player_id));

CREATE POLICY blade_reports_insert_authorized
ON public.blade_reports
FOR INSERT
TO authenticated
WITH CHECK (private.can_manage_player(player_id));

CREATE POLICY blade_reports_update_staff
ON public.blade_reports
FOR UPDATE
TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY blade_reports_delete_staff
ON public.blade_reports
FOR DELETE
TO authenticated
USING (private.is_staff((SELECT auth.uid())));
