CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.staff_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.staff_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.staff_roles FROM PUBLIC, anon, authenticated;

INSERT INTO private.staff_roles (user_id, role, active)
SELECT u.id, 'admin', true
FROM auth.users AS u
WHERE (u.id = 'd6a47529-f118-48b8-afc1-788b68562fb3'::uuid AND lower(u.email) = 'jordan@edgehockeyperformance.com')
   OR (u.id = 'b0870385-9f89-434c-8f33-b60fadaa5382'::uuid AND lower(u.email) = 'mike@edgehockeyperformance.com')
ON CONFLICT (user_id) DO UPDATE
SET role = EXCLUDED.role,
    active = EXCLUDED.active;

CREATE OR REPLACE FUNCTION private.is_staff(check_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.staff_roles AS sr
    WHERE sr.user_id = check_user
      AND sr.role = 'admin'
      AND sr.active = true
  );
$$;

REVOKE ALL ON FUNCTION private.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_staff(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.enforce_profile_privilege_boundaries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT private.is_staff(auth.uid()) THEN
      NEW.role := 'player';
      NEW.plan := 'free';
      NEW.sharpenings_used := 0;
      NEW.sharpenings_allowed := 0;
      NEW.internal_notes := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT private.is_staff(auth.uid()) THEN
    NEW.id := OLD.id;
    NEW.email := OLD.email;
    NEW.role := OLD.role;
    NEW.plan := OLD.plan;
    NEW.sharpenings_used := OLD.sharpenings_used;
    NEW.sharpenings_allowed := OLD.sharpenings_allowed;
    NEW.member_since := OLD.member_since;
    NEW.steel_height_toe_l := OLD.steel_height_toe_l;
    NEW.steel_height_toe_r := OLD.steel_height_toe_r;
    NEW.steel_height_mid_l := OLD.steel_height_mid_l;
    NEW.steel_height_mid_r := OLD.steel_height_mid_r;
    NEW.steel_height_heel_l := OLD.steel_height_heel_l;
    NEW.steel_height_heel_r := OLD.steel_height_heel_r;
    NEW.steel_edge_damage := OLD.steel_edge_damage;
    NEW.steel_profile_wear := OLD.steel_profile_wear;
    NEW.steel_condition := OLD.steel_condition;
    NEW.steel_health_score := OLD.steel_health_score;
    NEW.steel_health_notes := OLD.steel_health_notes;
    NEW.internal_notes := OLD.internal_notes;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_profile_privilege_boundaries() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER protect_profile_privileged_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION private.enforce_profile_privilege_boundaries();

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
        'blade_reports'
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

CREATE POLICY profiles_select_authorized
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) = id
  OR private.is_staff((SELECT auth.uid()))
);

CREATE POLICY profiles_insert_self
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY profiles_update_authorized
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  (SELECT auth.uid()) = id
  OR private.is_staff((SELECT auth.uid()))
)
WITH CHECK (
  (SELECT auth.uid()) = id
  OR private.is_staff((SELECT auth.uid()))
);

CREATE POLICY appointments_select_authorized
ON public.appointments
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

CREATE POLICY appointments_insert_authorized
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

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
USING (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

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
USING (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

CREATE POLICY skate_log_insert_self
ON public.skate_log
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = player_id);

CREATE POLICY skate_log_update_self
ON public.skate_log
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = player_id)
WITH CHECK ((SELECT auth.uid()) = player_id);

CREATE POLICY skate_log_delete_self
ON public.skate_log
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) = player_id);

CREATE POLICY steel_select_authorized
ON public.steel
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

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
USING (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

CREATE POLICY steel_history_insert_authorized
ON public.steel_history
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

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
USING (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

CREATE POLICY blade_reports_insert_authorized
ON public.blade_reports
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = player_id
  OR private.is_staff((SELECT auth.uid()))
);

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

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin, service_role;
ALTER FUNCTION public.handle_new_user() SET search_path = '';

DROP POLICY IF EXISTS "Public can read blade-reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to blade-reports" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own blade-reports" ON storage.objects;

CREATE POLICY blade_reports_upload_authenticated
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'blade-reports');

CREATE POLICY blade_reports_delete_own
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'blade-reports'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

CREATE INDEX IF NOT EXISTS appointments_player_id_idx ON public.appointments(player_id);
CREATE INDEX IF NOT EXISTS blade_reports_player_id_idx ON public.blade_reports(player_id);
CREATE INDEX IF NOT EXISTS sharpenings_player_id_idx ON public.sharpenings(player_id);
CREATE INDEX IF NOT EXISTS skate_log_player_id_idx ON public.skate_log(player_id);
CREATE INDEX IF NOT EXISTS steel_history_player_id_idx ON public.steel_history(player_id);
